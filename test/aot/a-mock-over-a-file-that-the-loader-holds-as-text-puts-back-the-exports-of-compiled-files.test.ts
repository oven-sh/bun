import { expect } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { beforeAll, describe, test } from "./supported";

// A barrel is loaded a second time, from its text, and the loader holds what it made of that text. The file that it hands names on from stays compiled.
// A mock of the barrel stores its values where compiled code keeps those names. The end of the mock has to put back what was there, into the place that
// it was taken from: the test file reads the file's own functions again, and so does the next test file.
// Plain `bun test` says what is right. Where a run with --aot prints another line today for a reason that is not this one, the case lists it in `differs`.
// The other way round, a mock below such a barrel: a-mock-laid-below-a-compiled-file-that-the-loader-holds-as-text-is-seen-by-it.test.ts.

raiseDefaultTimeout(300_000);

type Case = {
  files: Record<string, string>;
  /** The test files, in the order in which they run. */
  tests: string[];
  /** Steps whose line with --aot is not the line of plain `bun test`: the values that --aot prints, and why. */
  differs?: Record<string, [values: string, why: string]>;
  /** The run with --aot says that this file of the case ran from source. */
  fromSource?: string | false;
};

const head = (name: string) => `import { jest, mock, spyOn, test, vi } from "bun:test";
import { createRequire } from "node:module";
import { join } from "node:path";
const ask = createRequire(import.meta.url);
const world = globalThis as any;
const say = (step: string, ...values: unknown[]) => console.log("| ${name}", step, values.join());
const tried = (body: () => unknown) => { try { return body(); } catch (error: any) { return "threw " + error.constructor.name; } };
`;
// Each load of the file makes functions of its own, so a function of one load that is stored into another load shows.
const counted = (name: string) =>
  `const world = globalThis as any;\nconst load = (world[${JSON.stringify(name)}] = (world[${JSON.stringify(name)}] ?? 0) + 1);\n`;
const own = (name: string) =>
  `${counted(name)}export const greet = () => "real#" + load;\nexport const help = () => "real#" + load;\n`;
const star = `export * from "./dep.ts";\n`;
const written = `'export * from "./dep.ts";\\n// written by the test\\n'`;
// The entry of the barrel is taken out of the cache, so its second load runs from its text.
const again = (name: string) =>
  `  await import("./${name}/barrel.ts");
  delete ask.cache[ask.resolve("./${name}/barrel.ts")];
  const barrel = await import("./${name}/barrel.ts");
`;
const factory = `() => ({ greet: () => "mock", help: () => "mock" })`;
const next = (name: string) =>
  `import { greet, help } from "./${name}/dep.ts";\ntest("${name}, the next file", () => say("next", greet(), help()));\n`;
const below = (name: string) => ({
  "util.ts": `export const name = () => "util";\n`,
  "dep.ts": `import { name } from "./util.ts";\n${counted(name)}export const greet = () => "real#" + load;\nexport const help = () => "real#" + load + ":" + name();\n`,
  "barrel.ts": star,
});

// A mock names a file that dep.ts imports, so a test run may load dep.ts again: each load has variables of its own.
const canLoadAgain = (name: string): Case => ({
  files: below(name),
  tests: [
    `import { greet, help } from "./${name}/dep.ts";
test("${name}", async () => {
${again(name)}  mock.module("./${name}/barrel.ts", ${factory});
  say("mocked", barrel.greet(), greet(), help());
  vi.doUnmock("./${name}/barrel.ts");
  say("ended", barrel.greet(), greet(), help());
  mock.module("./${name}/util.ts", () => ({ name: () => "mock" }));
  say("below", help());
});
`,
    next(name),
  ],
});
// The mock of util.ts ends first. That lets go of what dep.ts had loaded, where the mock of the barrel has stored.
const letGo = (name: string): Case => ({
  files: below(name),
  tests: [
    `import { greet, help } from "./${name}/dep.ts";
test("${name}", async () => {
${again(name)}  mock.module("./${name}/barrel.ts", ${factory});
  mock.module("./${name}/util.ts", () => ({ name: () => "mock" }));
  vi.doUnmock("./${name}/util.ts");
  say("mocked", barrel.greet(), greet(), help());
  vi.doUnmock("./${name}/barrel.ts");
  say("ended", barrel.greet(), greet(), help());
  const later = await import("./${name}/dep.ts");
  say("later", later.greet(), later.help());
});
`,
    next(name),
  ],
});
// The same, and dep.ts is loaded again before the mock of the barrel ends: the mock stays in the first load, and its end must put back there.
const loadedAgainFirst = (name: string): Case => ({
  files: below(name),
  tests: [
    `import { greet, help } from "./${name}/dep.ts";
test("${name}", async () => {
${again(name)}  mock.module("./${name}/barrel.ts", ${factory});
  mock.module("./${name}/util.ts", () => ({ name: () => "mock" }));
  const under = await import("./${name}/dep.ts");
  say("under", barrel.greet(), greet(), under.greet(), under.help());
  vi.doUnmock("./${name}/util.ts");
  const behind = await import("./${name}/dep.ts");
  say("behind", barrel.greet(), greet(), behind.greet(), behind.help());
  vi.doUnmock("./${name}/barrel.ts");
  say("ended", barrel.greet(), greet(), help(), under.greet(), under.help(), behind.greet(), behind.help());
  const later = await import("./${name}/dep.ts");
  say("later", later.greet(), later.help());
});
`,
    next(name),
  ],
});
// The same, and the names come through one more file. What the mock keeps is of the first load: a read of the barrel without its mock must not
// give that for a name that leads to the second load by then.
const loadedAgainBehindAFile = (name: string): Case => ({
  files: {
    "util.ts": `export const name = () => "util";\n`,
    "inner.ts": `import { name } from "./util.ts";\n${counted(name)}export const greet = () => "real#" + load;\nexport const help = () => "real#" + load + ":" + name();\n`,
    "dep.ts": `export * from "./inner.ts";\n`,
    "barrel.ts": star,
  },
  tests: [
    `import { greet, help } from "./${name}/dep.ts";
test("${name}", async () => {
${again(name)}  mock.module("./${name}/barrel.ts", ${factory});
  mock.module("./${name}/util.ts", () => ({ name: () => "mock" }));
  await import("./${name}/dep.ts");
  vi.doUnmock("./${name}/util.ts");
  const behind = await import("./${name}/dep.ts");
  say("behind", barrel.greet(), greet(), behind.greet(), behind.help());
  const actual = await vi.importActual<typeof import("./${name}/dep.ts")>("./${name}/barrel.ts");
  say("actual", actual.greet(), actual.help(), jest.requireActual("./${name}/barrel.ts").greet());
  vi.doUnmock("./${name}/barrel.ts");
  say("ended", barrel.greet(), greet(), help(), behind.greet(), behind.help());
});
`,
    next(name),
  ],
});
const loadedAgain = (): Record<string, (name: string) => Case> => ({
  "the-file-below-can-load-again": canLoadAgain,
  "the-file-below-is-let-go-before-the-mock-ends": letGo,
  "the-file-below-is-loaded-again-before-the-mock-ends": loadedAgainFirst,
  "the-file-below-is-loaded-again-behind-a-file-that-hands-it-on": loadedAgainBehindAFile,
});

// node:path has a mock of its own while the mock of a barrel over its names stands. Each of the two keeps what it replaced, and its end puts that back,
// whichever was laid first and whichever ends first. late.ts is loaded under both. After jest.resetModules() the mock of node:path stands in place of
// the module, which sets the table of its exports aside.
const withMockOfBuiltIn =
  (steps: string) =>
  (name: string): Case => ({
    files: {
      "barrel.ts": `export { basename, extname } from "node:path";\n`,
      "late.ts": `import { basename } from "node:path";\nexport const base = () => basename("/a/b.txt");\n`,
    },
    tests: [
      `import { basename, extname } from "node:path";
test("${name}", async () => {
${again(name)}  const look = (step: string) => say(step, barrel.basename("/a/b.txt"), barrel.extname("/a/b.txt"), basename("/a/b.txt"), extname("/a/b.txt"));
  const mockBarrel = () => void mock.module("./${name}/barrel.ts", () => ({ basename: () => "barrel", extname: () => "barrel" }));
  const mockBuiltIn = () => void mock.module("node:path", () => ({ basename: () => "built-in" }));
  const late = async () => say("late", (await import("./${name}/late.ts")).base());
  const endBarrel = () => vi.doUnmock("./${name}/barrel.ts");
  const endBuiltIn = () => vi.doUnmock("node:path");
${steps}
  const later = await import("node:path");
  say("later", later.basename("/a/b.txt"), later.extname("/a/b.txt"));
});
`,
      `import { basename, extname } from "node:path";\ntest("${name}, the next file", () => say("next", basename("/a/b.txt"), extname("/a/b.txt")));\n`,
    ],
  });
const barrelEndsFirst = `  endBarrel();\n  look("barrel ended");\n  endBuiltIn();\n  look("both ended");`;
const builtInEndsFirst = `  endBuiltIn();\n  look("built-in ended");\n  endBarrel();\n  look("both ended");`;
const mockOfBuiltIn = (reset = ""): Record<string, (name: string) => Case> => {
  const barrelFirst = `  mockBarrel();\n  look("barrel");\n${reset}  mockBuiltIn();\n  await late();\n  look("both");\n`;
  const builtInFirst = `${reset}  mockBuiltIn();\n  look("built-in");\n  mockBarrel();\n  await late();\n  look("both");\n`;
  return {
    "a-built-in-module-below-is-mocked-later-and-the-barrel-ends-first": withMockOfBuiltIn(
      barrelFirst + barrelEndsFirst,
    ),
    "a-built-in-module-below-is-mocked-later-and-ends-first": withMockOfBuiltIn(barrelFirst + builtInEndsFirst),
    "a-built-in-module-below-is-mocked-before-and-the-barrel-ends-first": withMockOfBuiltIn(
      builtInFirst + barrelEndsFirst,
    ),
    "a-built-in-module-below-is-mocked-before-and-ends-first": withMockOfBuiltIn(builtInFirst + builtInEndsFirst),
  };
};

const refusesNamespace =
  "with --aot a namespace that a file hands on is replaced only by a mock of a file that runs compiled";
const cases: Record<string, (name: string) => Case> = {
  "the-mock-is-removed": name => ({
    files: { "dep.ts": own(name), "barrel.ts": star },
    tests: [
      `import { greet, help } from "./${name}/dep.ts";
test("${name}", async () => {
${again(name)}  say("loaded", barrel.greet(), greet(), help());
  mock.module("./${name}/barrel.ts", ${factory});
  say("mocked", barrel.greet(), greet(), help());
  const actual = await vi.importActual<typeof import("./${name}/dep.ts")>("./${name}/barrel.ts");
  say("actual", actual.greet(), actual.help());
  vi.doUnmock("./${name}/barrel.ts");
  say("ended", barrel.greet(), greet(), help());
});
`,
      next(name),
    ],
  }),
  "the-test-file-ends": name => ({
    files: { "dep.ts": own(name), "barrel.ts": star },
    tests: [
      `import { greet, help } from "./${name}/dep.ts";
test("${name}", async () => {
${again(name)}  mock.module("./${name}/barrel.ts", ${factory});
  say("mocked", barrel.greet(), greet(), help());
});
`,
      next(name),
    ],
  }),
  // The second file does nothing out of the ordinary: the loader still holds the barrel that the first file loaded from its text.
  "a-later-file-mocks-the-barrel-at-its-top": name => ({
    files: { "dep.ts": own(name), "barrel.ts": star },
    tests: [
      `test("${name}", async () => {
${again(name)}  say("loaded", barrel.greet());
});
`,
      `import { greet, help } from "./${name}/dep.ts";
vi.mock("./${name}/barrel.ts", ${factory});
test("${name}, the file with the mock", () => say("mocked", greet(), help()));
`,
      next(name),
    ],
  }),
  "a-second-mock-replaces-the-first": name => ({
    files: { "dep.ts": own(name), "barrel.ts": star },
    tests: [
      `import { greet, help } from "./${name}/dep.ts";
test("${name}", async () => {
${again(name)}  mock.module("./${name}/barrel.ts", ${factory});
  mock.module("./${name}/barrel.ts", () => ({ greet: () => "second" }));
  say("mocked", barrel.greet(), greet(), help());
  vi.doUnmock("./${name}/barrel.ts");
  say("ended", barrel.greet(), greet(), help());
});
`,
      next(name),
    ],
  }),
  "the-factory-takes-the-original": name => ({
    files: { "dep.ts": own(name), "barrel.ts": star },
    tests: [
      `import { greet, help } from "./${name}/dep.ts";
test("${name}", async () => {
${again(name)}  await mock.module("./${name}/barrel.ts", async (original: () => Promise<object>) => ({ ...(await original()), greet: () => "mock" }));
  say("mocked", barrel.greet(), greet(), help());
  vi.doUnmock("./${name}/barrel.ts");
  say("ended", barrel.greet(), greet(), help());
});
`,
      next(name),
    ],
  }),
  // jest.requireActual() reads what the mock keeps. A mock without a factory replaces each function by one that returns nothing.
  "jest-lays-the-mock": name => ({
    files: { "dep.ts": own(name), "barrel.ts": star },
    tests: [
      `import { greet, help } from "./${name}/dep.ts";
test("${name}", async () => {
${again(name)}  jest.mock("./${name}/barrel.ts", ${factory});
  say("mocked", barrel.greet(), greet(), help());
  const actual = jest.requireActual("./${name}/barrel.ts");
  say("actual", actual.greet(), actual.help());
  jest.mock("./${name}/barrel.ts");
  say("without a factory", typeof barrel.greet, String(barrel.greet()), String(greet()));
});
`,
      next(name),
    ],
  }),
  // The barrel changed on disk after the build, which is the other way to a load from its text.
  "the-barrel-is-written-again": name => ({
    files: { "dep.ts": own(name), "barrel.ts": star },
    tests: [
      `import { greet, help } from "./${name}/dep.ts";
test("${name}", async () => {
  const path = join(import.meta.dir, "${name}", "bar" + "rel.ts");
  await Bun.write(path, ${written});
  const barrel = await import(path);
  mock.module(path, ${factory});
  say("mocked", barrel.greet(), greet(), help());
  vi.doUnmock(path);
  say("ended", barrel.greet(), greet(), help());
});
`,
      next(name),
    ],
  }),
  ...loadedAgain(),
  ...mockOfBuiltIn(),
  "the-barrel-hands-on-a-built-in-module": name => ({
    files: { "barrel.ts": `export { basename, extname } from "node:path";\n` },
    tests: [
      `import { basename, extname } from "node:path";
test("${name}", async () => {
${again(name)}  mock.module("./${name}/barrel.ts", () => ({ basename: () => "mock", extname: () => "mock" }));
  say("mocked", barrel.basename("/a/b.txt"), basename("/a/b.txt"), extname("/a/b.txt"));
  vi.doUnmock("./${name}/barrel.ts");
  say("ended", barrel.basename("/a/b.txt"), basename("/a/b.txt"), extname("/a/b.txt"));
});
`,
      `import { basename, extname } from "node:path";\ntest("${name}, the next file", () => say("next", basename("/a/b.txt"), extname("/a/b.txt")));\n`,
    ],
  }),
  // node:fs makes ReadStream at its first read, and a compiled file that imports the name reads it. So the barrel is written before its first load:
  // the mock must not make the name, and its end gives the one of node:fs back.
  "the-barrel-hands-on-a-name-that-a-built-in-module-makes-late": name => ({
    files: { "barrel.ts": `export {};\n` },
    tests: [
      `const made = () => (Object.getOwnPropertyDescriptor(ask("node:" + "fs"), "ReadStream")!.get ? "not made" : "made");
test("${name}", async () => {
  const path = join(import.meta.dir, "${name}", "bar" + "rel.ts");
  await Bun.write(path, 'export { ReadStream, readFileSync } from "node:fs";\\n');
  const barrel = await import(path);
  mock.module(path, () => ({ ReadStream: function MockRead() {}, readFileSync: function mockRead() {} }));
  say("mocked", barrel.ReadStream.name, barrel.readFileSync.name, made());
  const actual = await vi.importActual<any>(path);
  say("actual", Object.keys(actual).sort().join("+"), made());
  vi.doUnmock(path);
  say("ended", barrel.ReadStream.name, barrel.readFileSync.name);
});
`,
      `import { ReadStream, readFileSync } from "node:fs";\ntest("${name}, the next file", () => say("next", ReadStream.name, readFileSync.name));\n`,
    ],
  }),
  // The mock is made while dep.ts waits at its await: its names have no value yet, and the mock keeps nothing for them.
  "the-file-below-has-not-run": name => ({
    files: {
      "dep.ts": `(globalThis as any).reached?.();\nawait (globalThis as any).gate;\n${own(name)}`,
      "barrel.ts": star,
    },
    tests: [
      `test("${name}", async () => {
  const reached = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  Object.assign(world, { reached: reached.resolve, gate: gate.promise });
  const path = join(import.meta.dir, "${name}", "bar" + "rel.ts");
  await Bun.write(path, ${written});
  const loading = import(path);
  await reached.promise;
  mock.module(path, ${factory});
  gate.resolve();
  const barrel = await loading;
  say("mocked", barrel.greet(), barrel.help());
  vi.doUnmock(path);
  say("ended", barrel.greet(), barrel.help());
  Object.assign(world, { reached: undefined, gate: undefined });
});
`,
      next(name),
    ],
  }),
  // caller.ts makes the mock while the barrel is linked and has not run. Once dep.ts has run, the mock keeps what it stored over then.
  "the-mock-is-made-while-the-barrel-loads": name => ({
    files: {
      "dep.ts": `await 0;\n${own(name)}`,
      "barrel.ts": star,
      "caller.ts": `import { mock } from "bun:test";\nconst world = globalThis as any;\nif (world.barrelToMock) world.mocked = mock.module(world.barrelToMock, ${factory});\nexport {};\n`,
      "importer.ts": `import "./caller.ts";\nimport { greet, help } from "./barrel.ts";\nexport const read = () => [greet(), help()];\n`,
    },
    tests: [
      `test("${name}", async () => {
  const barrel = join(import.meta.dir, "${name}", "bar" + "rel.ts");
  const importer = join(import.meta.dir, "${name}", "impor" + "ter.ts");
  await Bun.write(barrel, ${written});
  await Bun.write(importer, 'import "./caller.ts";\\nimport { greet, help } from "./barrel.ts";\\nexport const read = () => [greet(), help()];\\n// written by the test\\n');
  world.barrelToMock = barrel;
  const { read } = await import(importer);
  await world.mocked;
  world.barrelToMock = undefined;
  const dep = await import("./${name}/dep.ts");
  say("mocked", read(), dep.greet(), dep.help());
  vi.doUnmock(barrel);
  say("ended", read(), dep.greet(), dep.help());
});
`,
      next(name),
    ],
  }),
  // The factory of a mock of dep.ts imports the barrel, which hands on the names of the original of dep.ts there.
  "the-factory-of-a-mock-below-mocks-the-barrel": name => ({
    files: { "dep.ts": own(name), "barrel.ts": star },
    tests: [
      `test("${name}", async () => {
  const path = join(import.meta.dir, "${name}", "bar" + "rel.ts");
  await Bun.write(path, ${written});
  let barrel: any;
  mock.module("./${name}/dep.ts", async () => {
    barrel = await import(path);
    mock.module(path, ${factory});
    say("mocked", barrel.greet(), barrel.help());
    vi.doUnmock(path);
    say("ended", barrel.greet(), barrel.help());
    return { greet: () => "below", help: () => "below" };
  });
  const dep = await import("./${name}/dep.ts");
  say("below", dep.greet(), barrel.greet(), barrel.help());
  vi.doUnmock("./${name}/dep.ts");
  say("behind", (await import("./${name}/dep.ts")).greet(), barrel.greet(), barrel.help());
});
`,
      next(name),
    ],
  }),
  // The barrel hands a namespace on, and compiled code refuses a store there: mock.module() throws. What it stored before that must not stay.
  "a-store-of-the-mock-is-refused": name => ({
    files: {
      "dep.ts": own(name),
      "tools.ts": `export const tool = () => "tool";\n`,
      "barrel.ts": `export * from "./dep.ts";\nexport * as tools from "./tools.ts";\n`,
    },
    tests: [
      `import { greet, help } from "./${name}/dep.ts";
test("${name}", async () => {
${again(name)}  say("laid", tried(() => void mock.module("./${name}/barrel.ts", () => ({ ...barrel, greet: () => "mock" }))));
  say("mocked", barrel.greet(), greet(), help());
  vi.doUnmock("./${name}/barrel.ts");
  say("ended", barrel.greet(), greet(), help());
});
`,
      next(name),
    ],
    differs: {
      laid: ["threw TypeError", refusesNamespace],
      mocked: ["real#1,real#1,real#1", "mock.module() threw"],
    },
  }),
  // The same while a first mock stands: the second stores nothing, and what the first stored stays until the mock ends.
  "a-store-of-a-second-mock-is-refused": name => ({
    files: {
      "dep.ts": own(name),
      "tools.ts": `export const tool = () => "tool";\n`,
      "barrel.ts": `export * from "./dep.ts";\nexport * as tools from "./tools.ts";\n`,
    },
    tests: [
      `import { greet, help } from "./${name}/dep.ts";
test("${name}", async () => {
${again(name)}  mock.module("./${name}/barrel.ts", () => ({ help: () => "first" }));
  say("first", barrel.greet(), greet(), help());
  say("laid", tried(() => void mock.module("./${name}/barrel.ts", () => ({ ...barrel, greet: () => "second" }))));
  say("second", barrel.greet(), greet(), help());
  vi.doUnmock("./${name}/barrel.ts");
  say("ended", barrel.greet(), greet(), help());
});
`,
      next(name),
    ],
    differs: {
      laid: ["threw TypeError", refusesNamespace],
      second: ["real#1,real#1,first", "mock.module() threw"],
    },
  }),
  // The spy is laid first, so the mock keeps the spy as what it replaced. Plain bun test puts the restored spy back too.
  "a-spy-is-laid-before-the-mock": name => ({
    files: { "dep.ts": own(name), "barrel.ts": star },
    tests: [
      `import { greet, help } from "./${name}/dep.ts";
test("${name}", async () => {
${again(name)}  const spy = spyOn(barrel, "greet").mockReturnValue("spy");
  mock.module("./${name}/barrel.ts", ${factory});
  say("mocked", barrel.greet(), greet(), help());
  spy.mockRestore();
  say("spy restored", barrel.greet(), greet(), help());
  vi.doUnmock("./${name}/barrel.ts");
  say("ended", String(barrel.greet()), String(greet()), help());
});
`,
      `import { greet, help } from "./${name}/dep.ts";\ntest("${name}, the next file", () => say("next", String(greet()), help()));\n`,
    ],
  }),
  // A spy keeps what it replaced by itself. It is here to show that the two ends agree.
  "a-spy-on-the-barrel": name => ({
    files: { "dep.ts": own(name), "barrel.ts": star },
    tests: [
      `import { greet, help } from "./${name}/dep.ts";
test("${name}", async () => {
${again(name)}  const spy = spyOn(barrel, "greet").mockReturnValue("spy");
  say("spied", barrel.greet(), greet(), help());
  spy.mockRestore();
  say("ended", barrel.greet(), greet(), help());
});
`,
      next(name),
    ],
  }),
  // The barrel runs compiled here: the program keeps what the mock replaced.
  "the-barrel-runs-compiled": name => ({
    files: { "dep.ts": own(name), "barrel.ts": star },
    tests: [
      `import { greet, help } from "./${name}/dep.ts";
test("${name}", async () => {
  const barrel = await import("./${name}/barrel.ts");
  mock.module("./${name}/barrel.ts", ${factory});
  say("mocked", barrel.greet(), greet(), help());
  vi.doUnmock("./${name}/barrel.ts");
  say("ended", barrel.greet(), greet(), help());
});
`,
      next(name),
    ],
    fromSource: false,
  }),
};

// A plugin names Bun.plugin, and a run with that name in it is compiled so that any file may load again. So these are a project of their own.
const withPlugins: Record<string, (name: string) => Case> = {
  // A plugin gives the text of the barrel, so the loader holds it. importer.ts is above it and runs from its text too.
  "a-plugin-gives-the-text": name => ({
    files: {
      "dep.ts": own(name),
      "barrel.ts": star,
      "importer.ts": `import { greet as direct } from "./dep.ts";\nimport { greet, help } from "./barrel.ts";\nexport const read = () => [greet(), direct(), help()];\n`,
    },
    tests: [
      `test("${name}", async () => {
  Bun.plugin({ name: "barrel", setup(build) { build.onLoad({ filter: /${name}[\\\\/]barrel\\.ts$/ }, () => ({ contents: 'export * from "./dep.ts";', loader: "ts" })); } });
  const { read } = await import("./${name}/importer.ts");
  mock.module("./${name}/barrel.ts", ${factory});
  say("mocked", read());
  vi.doUnmock("./${name}/barrel.ts");
  say("ended", read());
  Bun.plugin.clearAll();
});
`,
      `test("${name}, the next file", async () => say("next", (await import("./${name}/importer.ts")).read()));\n`,
    ],
    fromSource: "importer.ts",
  }),
  // The mock of dep.ts ends while dep.ts is being loaded for its factory. importer.ts and star.ts then run from their text, dep.ts and helpers.ts compiled.
  "a-mock-below-ends-while-the-file-is-loaded": name => ({
    files: {
      "slow.ts": `export const slow = "slow";\n`,
      "dep.ts": `import "./slow.ts";\nexport * from "./helpers.ts";\nexport const greet = () => "real";\n`,
      "helpers.ts": `export * from "./dep.ts";\nexport const help = () => "real";\n`,
      "star.ts": star,
      "importer.ts": `import { greet as direct } from "./dep.ts";\nimport { greet, help } from "./star.ts";\nexport const read = () => [greet(), direct(), help()];\n`,
    },
    tests: [
      `mock.module("./${name}/dep.ts", async (original: () => Promise<object>) => ({ ...(await original()), greet: () => "below" }));
test("${name}", async () => {
  const asked = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  Bun.plugin({ name: "slow", setup(build) { build.onLoad({ filter: /${name}[\\\\/]slow\\.ts$/ }, async () => { asked.resolve(); await gate.promise; return undefined as any; }); } });
  const loading = import("./${name}/importer.ts");
  await asked.promise;
  Bun.plugin.clearAll();
  gate.resolve();
  const { read } = await loading;
  say("loaded", read());
  mock.module("./${name}/star.ts", () => ({ __esModule: true, greet: () => "mock", help: () => "mock" }));
  say("mocked", read());
  vi.doUnmock("./${name}/star.ts");
  say("ended", read());
});
`,
      `test("${name}, the next file", async () => say("next", (await import("./${name}/importer.ts")).read()));\n`,
    ],
    differs: {
      mocked: [
        "mock,mock,mock",
        "plain bun test loads star.ts as the mock and stores nothing into what importer.ts reads",
      ],
    },
    fromSource: "star.ts",
  }),
};

// A test file that names vi.resetModules() makes a run of another kind: with --aot a file is loaded again only where that kind of run loads it, and
// every reader follows its last load. So the lines differ from plain bun test. What must hold in any kind: no load gets the functions of another one.
const followsLastLoad = "with --aot the readers of the first load follow the second load";
const loadsOnce = "with --aot dep.ts is not loaded again where a mock below it ends, and the run says so";
const differing = (make: (name: string) => Case, differs: Case["differs"]) => (name: string) => ({
  ...make(name),
  differs,
});
const withResetModules: Record<string, (name: string) => Case> = {
  "a-file-names-reset-modules": name => ({
    files: {},
    tests: [`test("${name}", () => {\n  if (world.never) vi.resetModules();\n  say("here");\n});\n`],
    fromSource: false,
  }),
  "the-file-below-can-load-again": differing(canLoadAgain, { next: ["real#1,real#1:util", loadsOnce] }),
  "the-file-below-is-let-go-before-the-mock-ends": differing(letGo, {
    later: ["real#1,real#1:util", loadsOnce],
    next: ["real#1,real#1:util", loadsOnce],
  }),
  "the-file-below-is-loaded-again-before-the-mock-ends": differing(loadedAgainFirst, {
    behind: ["mock,mock,mock,mock", loadsOnce],
    ended: ["real#1,real#1,real#1:util,real#1,real#1:util,real#1,real#1:util", loadsOnce],
    later: ["real#1,real#1:util", loadsOnce],
    next: ["real#1,real#1:util", loadsOnce],
  }),
  "the-file-below-is-loaded-again-behind-a-file-that-hands-it-on": differing(loadedAgainBehindAFile, {
    behind: ["real#2,real#2,real#2,real#2:util", followsLastLoad],
    ended: ["real#2,real#2,real#2:util,real#2,real#2:util", followsLastLoad],
  }),
  ...mockOfBuiltIn(`  jest.resetModules();\n`),
};

function projectOf(made: Record<string, (name: string) => Case>) {
  const files: Record<string, string> = {
    "package.json": `{ "name": "made-up", "private": true, "type": "module" }\n`,
  };
  const testFiles: string[] = [];
  for (const [name, make] of Object.entries(made)) {
    const one = make(name);
    for (const [file, text] of Object.entries(one.files)) files[`${name}/${file}`] = text;
    one.tests.forEach((text, index) => {
      files[`${name}.${index + 1}.test.ts`] = head(name) + text;
      testFiles.push(`./${name}.${index + 1}.test.ts`);
    });
  }
  return { files, testFiles };
}

// A debug build of Bun checks the iterators of its hash tables, and that check races between the threads of the compiler's Link stage
// (oven-sh/WebKit#1007): three builds of four stop there. A build on one thread has no race, and makes the same program.
const env = { ...bunEnv, NO_COLOR: "1", ...(isDebug && { BUN_DEBUG_TEST_AOT_WORDS: "threads=1" }) };

async function runOf(project: ReturnType<typeof projectOf>, ...flags: string[]) {
  using dir = tempDir("aot-a-mock-over-a-file-held-as-text", project.files);
  const { stdout, stderr, exitCode } = await run(
    [bunExe(), "test", "--parallel=1", ...flags, ...project.testFiles],
    String(dir),
    env,
  );
  if (exitCode !== 0) console.error(stderr);
  const linesOf = (name: string) => stdout.split("\n").filter(line => line.startsWith(`| ${name} `));
  return { linesOf, stderr, exitCode };
}

describe.each([
  ["files that need no plugin", cases],
  ["files that a plugin gives or holds back", withPlugins],
  ["a run that may reset its modules", withResetModules],
] as const)("%s", (_, made) => {
  describe.each(["--no-isolate", "--isolate"])("%s", isolation => {
    const project = projectOf(made);
    let plain: Awaited<ReturnType<typeof runOf>>;
    let compiled: Awaited<ReturnType<typeof runOf>>;
    beforeAll(async () => {
      [plain, compiled] = await Promise.all([runOf(project, isolation), runOf(project, isolation, "--aot")]);
    });

    test("both runs pass", () => {
      expect({ plain: plain.exitCode, compiled: compiled.exitCode }).toEqual({ plain: 0, compiled: 0 });
    });

    test.each(Object.keys(made))("%s", name => {
      const { differs = {}, fromSource = "barrel.ts" } = made[name](name);
      const lines = plain.linesOf(name);
      expect(lines.length).toBeGreaterThan(0);
      const expected = lines.map(line => {
        const step = Object.keys(differs).find(step => line.startsWith(`| ${name} ${step} `));
        return step ? `| ${name} ${step} ${differs[step][0]}` : line;
      });
      expect(compiled.linesOf(name)).toEqual(expected);
      // A barrel that ran compiled would make the case a copy of the control.
      if (fromSource) expect(compiled.stderr).toContain(`  ${name}/${fromSource}: `);
    });
  });
});

test("plain bun test prints what the cases mean to show", async () => {
  const plain = await runOf(projectOf(cases), "--no-isolate");
  expect(plain.linesOf("the-mock-is-removed")).toEqual([
    "| the-mock-is-removed loaded real#1,real#1,real#1",
    "| the-mock-is-removed mocked mock,mock,mock",
    "| the-mock-is-removed actual real#1,real#1",
    "| the-mock-is-removed ended real#1,real#1,real#1",
    "| the-mock-is-removed next real#1,real#1",
  ]);
  expect(plain.linesOf("the-file-below-is-loaded-again-before-the-mock-ends")).toEqual([
    "| the-file-below-is-loaded-again-before-the-mock-ends under mock,mock,mock,mock",
    "| the-file-below-is-loaded-again-before-the-mock-ends behind mock,mock,real#2,real#2:util",
    "| the-file-below-is-loaded-again-before-the-mock-ends ended real#1,real#1,real#1:util,real#1,real#1:util,real#2,real#2:util",
    "| the-file-below-is-loaded-again-before-the-mock-ends later real#2,real#2:util",
    "| the-file-below-is-loaded-again-before-the-mock-ends next real#2,real#2:util",
  ]);
});
