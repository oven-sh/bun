import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun test` decides what a mock, a reset and the end of a test file take out of its loader by WHICH TEST FILE loaded or mocked what (src/jsc/bindings/BunPlugin.cpp:
// evictModulesAndTheirImporters(), JSMock__undoModuleMocksOfTestFile(), JSMock__replaceModuleOfTestFile()). A case for each such rule, all laid as one project whose test
// files share a realm and are named in order on the command line: one plain run, and one compiled run a way. What `bun test` prints is the specification.
// mock-rules.known.txt holds what differs, a line `<way> <case> <what is asked>: <loud | SILENT> | <what is printed>`: a line that is cured, one that changes and a new one
// all fail. BUN_AOT_REWRITE_MOCK_RULES=1 writes the list anew.
type Case = { sources: Record<string, string>; tests: [imports: string, body: string][] };

const head = `import { test, vi, mock, jest } from "bun:test";
const say = (...words) => console.log("| CASE", ...words);
const tried = async read => { try { return String(await read()); } catch (e) { return "threw " + String(e.message).replace(/\\/\\S*\\//g, "").slice(0, 50); } };
`;
const first = { "first.js": `STATE ??= { made: 0, runs: 0, ok: false };\n` };
const dep = {
  ...first,
  "dep.js": `export const flag = "real";\n`,
  "user.js": `import { flag } from "./dep.js";\nSTATE.made++;\nlet calls = 0;\nexport const read = () => flag;\nexport const bump = () => ++calls;\n`,
};
const bad = {
  ...first,
  "bad.js": `STATE.runs++;\nif (!STATE.ok) throw new Error("not yet");\nexport const value = "fine";\n`,
  "other.js": `export const x = "real";\n`,
};
const start = `  STATE = { made: 0, runs: 0, ok: false };\n`;
const loadsBad = `await tried(async () => (await import("DIR/bad.js")).value), STATE.runs`;
const factory = `() => ({ flag: "mock" })`;
const cases: Record<string, Case> = {};

// "It may have failed because of a mock, and JSC forgets a failed module's requests": every pass of evictions takes out what failed to load or threw.
for (const [event, text] of Object.entries({
  domock: `vi.doMock("DIR/other.js", () => ({ x: "mock" }));`,
  module: `mock.module("DIR/other.js", () => ({ x: "mock" }));`,
  unmock: `vi.doMock("DIR/other.js", () => ({ x: "mock" })); vi.doUnmock("DIR/other.js");`,
  reset: `vi.resetModules();`,
  delete: `delete require.cache[require.resolve("DIR/bad.js")];`,
})) {
  cases[`failed-then-${event}`] = {
    sources: bad,
    tests: [
      [
        "",
        `${start}  say("first:", ${loadsBad});\n  STATE.ok = true;\n  say("again:", ${loadsBad});\n  await import("DIR/other.js");\n  ${text}\n  say("behind the event:", ${loadsBad});`,
      ],
    ],
  };
}
cases["failed-importer-then-reset"] = {
  sources: {
    ...bad,
    "index.js": `import { value } from "./bad.js";\nSTATE.made++;\nexport const through = value;\n`,
  },
  tests: [
    [
      "",
      `${start}  const load = async () => [await tried(async () => (await import("DIR/index.js")).through), STATE.runs, STATE.made].join(" ");
  say("first:", await load());\n  STATE.ok = true;\n  say("again:", await load());\n  vi.resetModules();\n  say("behind the reset:", await load());`,
    ],
  ],
};
cases["failed-cjs-then-reset"] = {
  sources: {
    ...first,
    "bad.cjs": `STATE.runs++;\nif (!STATE.ok) throw new Error("not yet");\nexports.value = "fine";\n`,
  },
  tests: [
    [
      "",
      `${start}  const load = () => tried(async () => (await import("DIR/bad.cjs")).value);
  say("first:", await load());\n  STATE.ok = true;\n  say("again:", await load());\n  vi.resetModules();\n  say("behind the reset:", await load());\n  say("runs:", STATE.runs);`,
    ],
  ],
};
// The end of a test file makes such a pass, once a mock has been made in the realm.
cases["failed-then-next-file"] = {
  sources: bad,
  tests: [
    ["", `${start}  say("first:", ${loadsBad});`],
    ["", `  STATE.ok = true;\n  say("the next file:", ${loadsBad});`],
  ],
};
cases["failed-then-statement"] = {
  sources: bad,
  tests: [
    ["", `${start}  say("first:", ${loadsBad});\n  STATE.ok = true;`],
    [`import { value } from "DIR/bad.js";\n`, `  say("the next file, by a statement:", value, STATE.runs);`],
  ],
};
// "Their mocks are undone, so the next file that imports them has to run them again."
for (const [name, call] of Object.entries({
  module: "mock.module",
  vimock: "vi.mock",
  domock: "vi.doMock",
  jest: "jest.mock",
})) {
  const uses = `import "DIR/first.js";\nimport "DIR/helper.js";\nimport { read } from "DIR/user.js";\n`;
  cases[`helper-${name}`] = {
    sources: { ...dep, "helper.js": `import { vi, mock, jest } from "bun:test";\n${call}("./dep.js", ${factory});\n` },
    tests: [
      [uses, `  say("file 1:", read());`],
      [uses, `  say("file 2:", read());`],
      [`import { read } from "DIR/user.js";\n`, `  say("file 3, without the helper:", read());`],
    ],
  };
}
// What vi.importActual() returned stays the original, one instance.
cases["actual-stays"] = {
  sources: { ...first, "dep.js": `STATE.made++;\nexport const flag = "real";\n` },
  tests: [
    [
      "",
      `${start}  const actual = await vi.importActual("DIR/dep.js");\n  vi.doMock("DIR/dep.js", ${factory});
  say("import:", (await import("DIR/dep.js")).flag, "actual:", actual.flag);
  const again = await vi.importActual("DIR/dep.js");\n  say("actual again:", again === actual ? "the same" : "another", again.flag, "bodies", STATE.made);`,
    ],
  ],
};
// "Linked to a mock's record that is no longer registered, e.g. after `delete require.cache[mocked]`."
cases["deleted-from-cache"] = {
  sources: dep,
  tests: [
    [
      "",
      `${start}  mock.module("DIR/dep.js", ${factory});\n  say("file 1:", (await import("DIR/user.js")).read());\n  delete require.cache[require.resolve("DIR/dep.js")];`,
    ],
    ["", `  say("file 2:", (await import("DIR/user.js")).read());`],
  ],
};
// Who goes with a mock over what an EARLIER file loaded: "This file's importers keep it. What an earlier file left is loaded again."
for (const [name, call] of Object.entries({ module: "mock.module", domock: "vi.doMock", jestdo: "jest.doMock" })) {
  const next: [string, string] = ["", `  say("the next file:", (await import("DIR/user.js")).read());`];
  cases[`this-files-user-${name}`] = {
    sources: dep,
    tests: [
      [`import "DIR/dep.js";\n`, `${start}  say("file 1 loads the file");`],
      [
        "",
        `  const before = await import("DIR/user.js");\n  ${call}("DIR/dep.js", ${factory});\n  const after = await import("DIR/user.js");\n  say("again:", after.read(), "held:", before.read());`,
      ],
      next,
    ],
  };
  cases[`earlier-files-user-${name}`] = {
    sources: dep,
    tests: [
      [`import "DIR/first.js";\nimport { read } from "DIR/user.js";\n`, `  say("file 1 loads the user:", read());`],
      ["", `  ${call}("DIR/dep.js", ${factory});\n  say("behind the mock:", (await import("DIR/user.js")).read());`],
      next,
    ],
  };
}
// The ordinary form: file 1 takes the user as it is, file 2 mocks and imports the user by a statement, file 3 mocks nothing. "calls": whether the user is made anew.
for (const [name, call] of Object.entries({ vimock: "vi.mock", jest: "jest.mock", module: "mock.module" })) {
  const uses = `import "DIR/first.js";\nimport { read, bump } from "DIR/user.js";\n`;
  cases[`ordinary-${name}`] = {
    sources: dep,
    tests: [
      [uses, `  bump();\n  say("file 1:", read(), "calls", bump());`],
      [
        uses,
        `  say("file 2:", read(), "calls", bump());\n});\n${call}("DIR/dep.js", ${factory});\ntest("CASE 2, behind the call", () => {`,
      ],
      [uses, `  say("file 3:", read(), "calls", bump());`],
    ],
  };
}
// "A hoisted factory that reads a variable declared below the call waits for the first import": over what an earlier file loaded.
for (const [name, call] of Object.entries({ vimock: "vi.mock", jest: "jest.mock" })) {
  const uses = `import "DIR/first.js";\nimport { read } from "DIR/user.js";\n`;
  cases[`hoisted-reads-below-${name}`] = {
    sources: dep,
    tests: [
      [uses, `  say("file 1:", read());`],
      [
        uses,
        `  say("file 2:", read(), "again:", (await import("DIR/user.js")).read());\n});\nconst below = "mock";\n${call}("DIR/dep.js", () => ({ flag: below }));\ntest("CASE 2, behind the call", () => {`,
      ],
      [uses, `  say("file 3:", read());`],
    ],
  };
}

const files: Record<string, string> = { "package.json": `{ "type": "module" }` };
// A package that an earlier file loaded is set aside while it is mocked, and stays one instance.
for (const [kind, type, text] of [
  ["esm", `, "type": "module"`, `export const flag = "real";\n`],
  ["cjs", "", `exports.flag = "real";\n`],
]) {
  for (const [name, call] of Object.entries({ vimock: "vi.mock", module: "mock.module", domock: "vi.doMock" })) {
    const pkg = `pkg-${kind}-${name}`;
    const made = `globalThis["made ${pkg}"]`;
    files[`node_modules/${pkg}/package.json`] = `{ "name": "${pkg}", "main": "index.js"${type} }`;
    files[`node_modules/${pkg}/index.js`] = `${made} = (${made} ?? 0) + 1;\n${text}`;
    const uses = `import { read } from "DIR/user.js";\n`;
    const mocks = `${call}("${pkg}", ${factory});`;
    cases[`package-${kind}-${name}`] = {
      sources: { "user.js": `import { flag } from "${pkg}";\nexport const read = () => flag;\n` },
      tests: [
        [uses, `  say("file 1:", read(), "made", ${made});`],
        name === "domock"
          ? ["", `  ${mocks}\n  say("file 2:", (await import("DIR/user.js")).read(), "made", ${made});`]
          : [
              uses,
              `  say("file 2:", read(), "made", ${made});\n});\n${mocks}\ntest("CASE 2, behind the call", () => {`,
            ],
        [uses, `  say("file 3:", read(), "made", ${made});`],
      ],
    };
  }
}
const inOrder: string[] = [];
for (const [name, { sources, tests }] of Object.entries(cases)) {
  const named = (text: string) =>
    text.replaceAll("CASE", name).replaceAll("DIR", `../c/${name}`).replaceAll("STATE", `globalThis["${name}"]`);
  for (const [path, text] of Object.entries(sources)) files[`c/${name}/${path}`] = named(text);
  tests.forEach(([imports, body], index) => {
    files[`t/${name}.${index + 1}.test.js`] = named(
      `${imports}${head}test("CASE ${index + 1}", async () => {\n${body}\n});\n`,
    );
    inOrder.push(`./t/${name}.${index + 1}.test.js`);
  });
}

const list = join(import.meta.dir, "mock-rules.known.txt");
const known = readFileSync(list, "utf8").split("\n");
const ways: Record<string, string> = { "one-program": "TestRunLayers:0" };

async function said(dir: string, words?: string) {
  const env = { ...bunEnv, NO_COLOR: "1", ...(words && { BUN_DEBUG_TEST_AOT_WORDS: words }) };
  const { stdout, stderr } = await run([bunExe(), "test", ...(words ? ["--aot"] : []), ...inOrder], dir, env);
  const lines = new Map<string, string>();
  for (const line of (stdout + "\n" + stderr).split("\n")) {
    const found = line.match(/^\| (\S+ [^:]+): ?(.*)$/);
    if (found) lines.set(found[1], found[2]);
  }
  return lines;
}

const dir = tempDir("aot-mock-rules", files);
afterAll(() => dir[Symbol.dispose]());
let saidByPlain: ReturnType<typeof said> | undefined;
const found: string[] = [];
for (const [way, words] of Object.entries(ways)) {
  test(`what each case prints: ${way}`, async () => {
    const [plain, compiled] = [await (saidByPlain ??= said(String(dir))), await said(String(dir), words)];
    // Every test file of every case says one line at the least.
    expect(plain.size).toBeGreaterThanOrEqual(inOrder.length);
    const differing = [...plain]
      .filter(([key, expected]) => compiled.get(key) !== expected)
      .map(([key]) => {
        const got = compiled.get(key) ?? "nothing";
        return `${way} ${key}: ${/threw |nothing/.test(got) ? "loud" : "SILENT"} | ${got}`;
      })
      .sort();
    found.push(...differing);
    if (process.env.BUN_AOT_REWRITE_MOCK_RULES) {
      writeFileSync(list, [...known.filter(line => line.startsWith("#")), ...found, ""].join("\n"));
      return;
    }
    expect(differing).toEqual(known.filter(line => line.startsWith(way + " ")));
  }, 600_000);
}
