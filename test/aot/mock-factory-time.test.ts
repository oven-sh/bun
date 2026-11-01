import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// When does the factory of a mock run? Small projects in which every module, every factory, every onLoad and every turn of the job queue says when it
// runs. What `bun test` prints is the specification, and `bun test --aot` prints the same, as one program and over two layers.
//
// What `bun test` does:
// - A factory without a parameter runs once the whole graph has been loaded: turns behind the import() call, behind the answers of plugins and behind the bodies
//   of the CommonJS files that run where they are loaded (those that use `exports`), and ahead of the body of any ES module. Several run in the order in which the
//   import statements come to their modules, depth first, each behind the promise of the one before. What stands under the name then decides: a mock that was
//   taken back or replaced meanwhile never runs.
// - A factory that takes importOriginal, or names vi.importActual() of its own module, runs when the evaluation comes to the module, behind the body of the
//   original, and whoever imports the module waits for it.
// - Under require() a factory runs where the require() of its own file stands.
//
// mock-factory-time.known.txt lists what is not so yet, a line `<project> <form>` each. Such a form is expected to differ, and the test fails once it doesn't.
const say = `function say(text) { (globalThis.said ??= []).push(text); }\n`;
const module = (name: string, imports: string[] = []) =>
  say + imports.map(path => `import "${path}";\n`).join("") + `say("${name}");\n`;
const lib = (name: string) =>
  say + `say("${name}");\nexport const v = "real ${name}";\nexport const other = "other ${name}";\n`;
const kinds = ["sync", "later", "original", "actual"] as const;
const factory = (kind: (typeof kinds)[number], name: string) =>
  ({
    sync: `() => { say("factory ${name}"); return { v: "mock ${name}" }; }`,
    later: `async () => { say("factory ${name}"); await Promise.resolve(); say("factory ${name} settles"); return { v: "mock ${name}" }; }`,
    original: `async importOriginal => { say("factory ${name}"); const o = await importOriginal(); say("factory ${name} has the original"); return { ...o, v: "mock ${name}" }; }`,
    actual: `async () => { say("factory ${name}"); const o = await vi.importActual("./${name}"); say("factory ${name} has the original"); return { ...o, v: "mock ${name}" }; }`,
  })[kind];
const head = `import { expect, jest, mock, test, vi } from "bun:test";\n` + say;
const end = (body: string) =>
  `test("t", async () => {\n${body}  console.log("SAID", globalThis.said.join(" | "));\n});\n`;
const turns = `const turns = n => { let p = Promise.resolve(); for (let i = 1; i <= n; i++) p = p.then(() => say("turn " + i)); };\n`;
const preloaded = ["--preload", "./preload.ts"];

const projects = new Map<string, { files: Record<string, string>; flags: string[] }>();
const add = (name: string, files: Record<string, string>, flags: string[] = []) =>
  projects.set(name, {
    files: { "package.json": `{ "name": "p", "type": "module" }`, "tsconfig.json": "{}", ...files },
    flags,
  });

for (const kind of kinds) {
  const two = { "a.ts": module("a", ["./lib1"]), "lib1.ts": lib("lib1"), "lib2.ts": lib("lib2") };
  const one = { "lib.ts": lib("lib") };
  const mocked = `  vi.doMock("./lib", ${factory(kind, "lib")});\n`;
  add(`own-two-${kind}`, {
    ...two,
    "t.test.ts": `${head}vi.mock("./lib2", ${factory(kind, "lib2")});\nvi.mock("./lib1", ${factory(kind, "lib1")});\nimport "./a";\nimport { v } from "./lib2";\nsay("test file");\n${end(`  console.log("ANSWER", v);\n`)}`,
  });
  add(`call-two-${kind}`, {
    ...two,
    "main.ts": module("main", ["./a", "./lib2"]),
    "t.test.ts": `${head}${turns}${end(`  vi.doMock("./lib2", ${factory(kind, "lib2")});\n  vi.doMock("./lib1", ${factory(kind, "lib1")});\n  turns(6);\n  const loading = import("./main");\n  say("import() returned");\n  await loading;\n  say("loaded");\n`)}`,
  });
  add(`levels-${kind}`, {
    "main.ts": module("main", ["./a", "./b", "./lib3"]),
    "a.ts": module("a", ["./a1"]),
    "a1.ts": module("a1", ["./lib1"]),
    "b.ts": module("b", ["./lib2"]),
    "lib1.ts": lib("lib1"),
    "lib2.ts": lib("lib2"),
    "lib3.ts": lib("lib3"),
    "t.test.ts":
      head +
      end(
        [1, 2, 3].map(i => `  vi.doMock("./lib${i}", ${factory(kind, "lib" + i)});\n`).join("") +
          `  await import("./main");\n`,
      ),
  });
  add(`cjs-in-front-${kind}`, {
    ...one,
    "main.ts": module("main", ["./first.cjs", "./lib", "./last.cjs"]),
    "first.cjs": `(globalThis.said ??= []).push("first.cjs");\n`,
    "last.cjs": `(globalThis.said ??= []).push("last.cjs");\n`,
    "t.test.ts": head + end(`${mocked}  await import("./main");\n`),
  });
  add(`cjs-at-load-${kind}`, {
    ...one,
    "main.ts": module("main", ["./lib", "./c.cjs"]),
    "c.cjs": `(globalThis.said ??= []).push("c.cjs");\nexports.c = 1;\n`,
    "t.test.ts": head + end(`${mocked}  await import("./main");\n`),
  });
  add(
    `on-load-${kind}`,
    {
      ...one,
      "preload.ts": `import { plugin } from "bun";\n${say}plugin({ name: "data", setup(build) { build.onLoad({ filter: /\\.data$/ }, async () => { say("onLoad asked"); await Promise.resolve(); await Promise.resolve(); say("onLoad answers"); return { contents: "(globalThis.said ??= []).push(\\"data\\"); export default 1;", loader: "js" }; }); } });\n`,
      "x.data": "",
      "main.ts": module("main", ["./x.data", "./lib"]),
      "t.test.ts": head + end(`${mocked}  await import("./main");\n`),
    },
    preloaded,
  );
  add(`importer-reads-${kind}`, {
    ...one,
    "b.ts": `${say}import { v } from "./lib";\nsay("b reads " + v);\nexport const seen = v + "!";\n`,
    "t.test.ts": head + end(`${mocked}  console.log("ANSWER", (await import("./b")).seen);\n`),
  });
  add(`slow-sibling-${kind}`, {
    ...one,
    "main.ts": module("main", ["./slow", "./lib", "./quick"]),
    "slow.ts": `${say}say("slow begins");\nawait Promise.resolve();\nawait Promise.resolve();\nsay("slow ends");\n`,
    "quick.ts": module("quick"),
    "t.test.ts": head + end(`${mocked}  await import("./main");\n`),
  });
  add(`two-importers-${kind}`, {
    ...one,
    "main.ts": module("main", ["./a", "./b"]),
    "a.ts": module("a", ["./lib"]),
    "b.ts": module("b", ["./lib"]),
    "t.test.ts":
      head +
      end(`${mocked}  await import("./main");\n  await import("./lib");\n  say("again");\n  await import("./b");\n`),
  });
  const reads = { ...one, "main.ts": `${say}import { v } from "./lib";\nsay("main reads " + v);\n` };
  add(`unmocked-meanwhile-${kind}`, {
    ...reads,
    "t.test.ts":
      head +
      end(
        `${mocked}  const loading = import("./main");\n  vi.doUnmock("./lib");\n  say("taken back");\n  await loading;\n`,
      ),
  });
  add(`replaced-meanwhile-${kind}`, {
    ...reads,
    "t.test.ts":
      head +
      end(
        `${mocked}  const loading = import("./main");\n  vi.doMock("./lib", () => { say("second factory"); return { v: "second" }; });\n  say("replaced");\n  await loading;\n`,
      ),
  });
  add(
    `preload-replaced-${kind}`,
    {
      ...one,
      "preload.ts": `import { vi } from "bun:test";\n${say}vi.mock("./lib", ${factory(kind, "lib").replaceAll("factory lib", "replaced factory")});\n`,
      "helper.ts": `import { vi } from "bun:test";\n${say}say("helper");\nvi.mock("./lib", () => { say("factory"); return { v: "mock" }; });\n`,
      "t.test.ts": `import "./helper";\n${head}import { v } from "./lib";\n${end(`  console.log("ANSWER", v);\n`)}`,
    },
    preloaded,
  );
  add(
    `preload-${kind}`,
    {
      ...one,
      "preload.ts": `import { vi } from "bun:test";\n${say}say("preload");\nvi.mock("./lib", ${factory(kind, "lib")});\n`,
      "a.ts": module("a", ["./lib"]),
      "t.test.ts": `${head}import "./a";\nimport { v } from "./lib";\nsay("test file");\n${end(`  console.log("ANSWER", v);\n`)}`,
    },
    preloaded,
  );
  add(`factory-imports-mock-${kind}`, {
    "main.ts": module("main", ["./lib1"]),
    "lib1.ts": lib("lib1"),
    "lib2.ts": lib("lib2"),
    "t.test.ts":
      head +
      end(
        `  vi.doMock("./lib2", ${factory(kind, "lib2")});\n  vi.doMock("./lib1", async () => { say("factory lib1"); const m = await import("./lib2"); say("factory lib1 reads " + m.v); return { v: "mock lib1" }; });\n  await import("./main");\n`,
      ),
  });
  add(`mock-module-${kind}`, {
    ...two,
    "main.ts": module("main", ["./a", "./lib2"]),
    "t.test.ts": `${head}${turns}${end(`  mock.module("./lib2", ${factory(kind, "lib2")});\n  mock.module("./lib1", ${factory(kind, "lib1")});\n  say("mocked");\n  turns(4);\n  const loading = import("./main");\n  say("import() returned");\n  await loading;\n`)}`,
  });
}
add("require-sync", {
  "main.cjs": `(globalThis.said ??= []).push("main begins"); require("./a.cjs"); require("./lib2.cjs"); globalThis.said.push("main ends");\n`,
  "a.cjs": `globalThis.said.push("a begins"); require("./lib1.cjs"); globalThis.said.push("a ends");\n`,
  "lib1.cjs": `globalThis.said.push("lib1"); exports.v = "real";\n`,
  "lib2.cjs": `globalThis.said.push("lib2"); exports.v = "real";\n`,
  "t.test.ts":
    head +
    end(
      `  jest.doMock("./lib2.cjs", ${factory("sync", "lib2")});\n  jest.doMock("./lib1.cjs", ${factory("sync", "lib1")});\n  say("mocked");\n  require("./main.cjs");\n`,
    ),
});

const known = new Set(
  readFileSync(join(import.meta.dir, "mock-factory-time.known.txt"), "utf8")
    .split("\n")
    .filter(line => line && !line.startsWith("#")),
);
const forms = { "one-program": "TestRunLayers:0", "two-layers": "TestRunLayers:2,TestRunPartFiles:1" };

const seen = async (dir: string, flags: string[], words?: string) => {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, exitCode } = await run([bunExe(), "test", ...(words ? ["--aot"] : []), ...flags], dir, env);
  return { exitCode, lines: stdout.split("\n").filter(line => /^(ANSWER|SAID) /.test(line)) };
};

for (const [name, { files, flags }] of projects) {
  test(name, async () => {
    using plainDir = tempDir("mock-factory-time", files);
    using oneProgramDir = tempDir("mock-factory-time", files);
    using twoLayersDir = tempDir("mock-factory-time", files);
    const [plain, oneProgram, twoLayers] = await Promise.all([
      seen(String(plainDir), flags),
      seen(String(oneProgramDir), flags, forms["one-program"]),
      seen(String(twoLayersDir), flags, forms["two-layers"]),
    ]);
    expect(plain.exitCode).toBe(0);
    expect(plain.lines.at(-1)).toStartWith("SAID ");
    for (const [form, compiled] of Object.entries({ "one-program": oneProgram, "two-layers": twoLayers })) {
      if (!known.has(`${name} ${form}`)) expect({ form, ...compiled }).toEqual({ form, ...plain });
      // It is as `bun test` now: its line goes out of mock-factory-time.known.txt.
      else expect({ form, ...compiled }).not.toEqual({ form, ...plain });
    }
  });
}
