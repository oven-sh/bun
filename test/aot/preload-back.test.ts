import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// Every module says when it runs.
const counted = (name: string) =>
  `globalThis.${name} = (globalThis.${name} ?? 0) + 1; console.log("${name} runs", globalThis.${name});`;
const show = (title: string, body: string, names = "test") =>
  `import { ${names} } from "bun:test";\ntest(${JSON.stringify(title)}, async () => {\n${body}\n});`;

const graph = {
  "db.js": `${counted("db")} export const name = "db " + globalThis.db;`,
  "helper.js": `import { name } from "./db.js"; ${counted("helper")} export const who = () => name; export const lazy = () => import("./lazy.js");`,
  "lazy.js": `import { name } from "./db.js"; ${counted("lazy")} export const who = () => name;`,
  "store.cjs": `${counted("store")} exports.id = globalThis.store;`,
  "preload.js": `import * as helper from "./helper.js"; globalThis.helperOfPreload = helper; globalThis.storeOfPreload = require("./store.cjs"); globalThis.faceOfPreload = await import("./store.cjs");`,
};
const asThePreloadLeftIt = `
  console.log((await import("./db.js")).name, (await import("./helper.js")) === helperOfPreload, (await helperOfPreload.lazy()).who(), helperOfPreload.who());
  console.log(require("./store.cjs") === storeOfPreload, require("./store.cjs").id, (await import("./store.cjs")).id, faceOfPreload.id);`;
const loadedAgain = `
  console.log((await import("./db.js")).name, (await import("./helper.js")).who(), (await helperOfPreload.lazy()).who(), helperOfPreload.who());
  console.log(require("./store.cjs") === storeOfPreload, require("./store.cjs").id, (await import("./store.cjs")).id, faceOfPreload.id);`;

const projects: Record<string, Record<string, string>> = {
  "vi.resetModules()": {
    ...graph,
    "1.test.js": show("resets", `vi.resetModules();${loadedAgain}`, "test, vi"),
    "2.test.js": show("behind it", asThePreloadLeftIt),
    "3.test.js": `import { name } from "./db.js"; import * as helper from "./helper.js"; import store from "./store.cjs";
      ${show("by statements, and resets once more", `console.log(name, helper === helperOfPreload, store === storeOfPreload); vi.resetModules(); vi.resetModules();${loadedAgain}`, "test, vi")}`,
    "4.test.js": show("behind that", asThePreloadLeftIt),
  },
  "jest.resetModules()": {
    ...graph,
    "1.test.js": show("resets", `jest.resetModules();${loadedAgain}`, "test, jest"),
    "2.test.js": show("behind it", asThePreloadLeftIt),
  },
  "a reset that loads nothing again": {
    ...graph,
    "1.test.js": show("resets", `vi.resetModules();`, "test, vi"),
    "2.test.js": show("behind it", asThePreloadLeftIt),
  },
  "what a test file loaded is no preload's": {
    ...graph,
    "own.js": `import { name } from "./db.js"; ${counted("own")} export const seen = name + ", own " + globalThis.own;`,
    "own.cjs": `${counted("ownFile")} exports.id = globalThis.ownFile;`,
    "1.test.js": `import { seen } from "./own.js";
      ${show("loads its own, and resets", `console.log(seen, require("./own.cjs").id); vi.resetModules(); console.log((await import("./own.js")).seen, require("./own.cjs").id);`, "test, vi")}`,
    "2.test.js": show(
      "behind it",
      `console.log((await import("./own.js")).seen, require("./own.cjs").id);${asThePreloadLeftIt}`,
    ),
    "3.test.js": `import { seen } from "./own.js";
      ${show("by a statement", `console.log(seen, require("./own.cjs").id);`)}`,
  },
  "delete require.cache[path] is for good": {
    ...graph,
    "1.test.js": show(
      "deletes",
      `delete require.cache[require.resolve("./store.cjs")]; console.log(require("./store.cjs") === storeOfPreload, require("./store.cjs").id);`,
    ),
    "2.test.js": show(
      "behind it",
      `console.log(require("./store.cjs") === storeOfPreload, require("./store.cjs").id);`,
    ),
  },
  "an entry stored in require.cache is for good": {
    ...graph,
    "1.test.js": show(
      "stores an entry",
      `require.cache[require.resolve("./store.cjs")] = { exports: { id: "stored" } }; console.log(require("./store.cjs").id);`,
    ),
    "2.test.js": show(
      "behind it",
      `console.log(require("./store.cjs") === storeOfPreload, require("./store.cjs").id);`,
    ),
  },
  "what a hook of the preload loads": {
    "late.cjs": `${counted("late")} exports.id = globalThis.late;`,
    "later.js": `${counted("later")} export const id = globalThis.later;`,
    "own.cjs": `${counted("own")} exports.id = globalThis.own;`,
    "preload.js": `import { beforeAll, beforeEach } from "bun:test";
      beforeAll(() => { globalThis.lateOfHook = require("./late.cjs"); });
      beforeEach(async () => { globalThis.laterOfHook ??= await import("./later.js"); });`,
    "1.test.js": show(
      "resets",
      `const own = require("./own.cjs"); vi.resetModules(); console.log(require("./late.cjs") === lateOfHook, require("./late.cjs").id, (await import("./later.js")) === laterOfHook, require("./own.cjs") === own);`,
      "test, vi",
    ),
    "2.test.js": show(
      "behind it",
      `console.log(require("./late.cjs") === lateOfHook, require("./late.cjs").id, (await import("./later.js")) === laterOfHook, (await import("./later.js")).id, require("./own.cjs").id);`,
    ),
  },
  "a hook of the preload resets": {
    ...graph,
    "preload.js": `${graph["preload.js"]} import { beforeEach, vi } from "bun:test"; beforeEach(() => void vi.resetModules());`,
    "1.test.js": show("behind the hook", loadedAgain),
    "2.test.js": `console.log("at the top:", (await import("./db.js")).name, require("./store.cjs").id);\n${show("behind it once more", loadedAgain)}`,
  },
  "the test that resets fails": {
    ...graph,
    "1.test.js": show(
      "resets and throws",
      `vi.resetModules();${loadedAgain}\n  throw new Error("thrown");`,
      "test, vi",
    ),
    "2.test.js": show("behind it", asThePreloadLeftIt),
  },
  "a mock that ends before its file, behind a reset": {
    ...graph,
    "1.test.js": show(
      "mocks, resets, restores",
      `mock.module("./db.js", () => ({ name: "mock" })); vi.resetModules(); console.log((await import("./db.js")).name, helperOfPreload.who()); mock.restore(); vi.doUnmock("./db.js");${loadedAgain}`,
      "test, mock, vi",
    ),
    "2.test.js": show("behind it", asThePreloadLeftIt),
  },
  "a reset, then a mock over the original": {
    ...graph,
    "1.test.js": show(
      "resets and mocks",
      `vi.resetModules(); vi.doMock("./db.js", async original => ({ ...(await original()), extra: 1 })); const db = await import("./db.js"); console.log(db.name, db.extra, helperOfPreload.who());`,
      "test, vi",
    ),
    "2.test.js": show("behind it", asThePreloadLeftIt),
  },
  "a reset in afterAll": {
    ...graph,
    "1.test.js": `import { afterAll } from "bun:test"; afterAll(() => void vi.resetModules());\n${show("resets behind it", `console.log((await import("./db.js")).name);`, "test, vi")}`,
    "2.test.js": show("behind it", asThePreloadLeftIt),
  },
  "a reset in afterEach": {
    ...graph,
    "1.test.js": `import { afterEach } from "bun:test"; afterEach(() => void vi.resetModules());\n${show("one", `console.log((await import("./db.js")).name, require("./store.cjs").id);`, "test, vi")}\ntest("two", async () => { console.log((await import("./db.js")).name, require("./store.cjs").id); });`,
    "2.test.js": show("behind it", asThePreloadLeftIt),
  },
  "a reset at the top of a test file": {
    ...graph,
    "1.test.js": `${show("behind the reset", `console.log(db.name, helperOfPreload.who());`, "test, vi")}\nvi.resetModules();\nconst db = await import("./db.js");`,
    "2.test.js": `import { name } from "./db.js";\n${show("behind it", `console.log(name);${asThePreloadLeftIt}`)}`,
  },
  "require.cache behind a reset": {
    ...graph,
    "1.test.js": show(
      "resets",
      `vi.resetModules(); console.log(require("./store.cjs").id, Object.keys(require.cache).filter(key => key.endsWith("store.cjs")).length);`,
      "test, vi",
    ),
    "2.test.js": show(
      "behind it",
      `const path = require.resolve("./store.cjs"); console.log(Object.keys(require.cache).filter(key => key.endsWith("store.cjs")).length, require.cache[path]?.exports === storeOfPreload, require.cache[path]?.loaded, require("./store.cjs") === storeOfPreload);`,
    ),
  },
  "a reset, then a mock": {
    ...graph,
    "1.test.js": show(
      "resets and mocks",
      `vi.resetModules(); vi.doMock("./db.js", () => (console.log("factory runs"), { name: "mock" }));${loadedAgain}`,
      "test, vi",
    ),
    "2.test.js": show("behind it", asThePreloadLeftIt),
  },
  "a mock, then a reset": {
    "one.cjs": `${counted("one")} exports.a = "real";`,
    "user.js": `import * as one from "./one.cjs"; ${counted("user")} export const seen = () => one.a;`,
    "preload.js": `globalThis.user = await import("./user.js"); globalThis.one = require("./one.cjs");`,
    ...Object.fromEntries(
      ["jest.doMock", "mock.module", "vi.doMock"].flatMap((mock, index) => [
        [
          `${2 * index + 1}.test.js`,
          show(
            mock,
            `${mock}("./one.cjs", () => ({ a: "mock" })); vi.resetModules(); console.log(require("./one.cjs").a);`,
            "test, jest, mock, vi",
          ),
        ],
        [
          `${2 * index + 2}.test.js`,
          show(
            "behind " + mock,
            `console.log(require("./one.cjs") === one, one.a, user.seen(), (await import("./user.js")) === user, (await import("./one.cjs")).a);`,
          ),
        ],
      ]),
    ),
  },
  "a getter of the mock resets": {
    "one.cjs": `${counted("one")} exports.a = "real";`,
    "preload.js": `await import("./one.cjs"); globalThis.one = require("./one.cjs");`,
    ...Object.fromEntries(
      ["jest.doMock", "mock.module", "vi.doMock"].flatMap((mock, index) => [
        [
          `${2 * index + 1}.test.js`,
          show(
            mock,
            `${mock}("./one.cjs", () => ({ get a() { vi.resetModules(); return "mock"; } }));`,
            "test, jest, mock, vi",
          ),
        ],
        [
          `${2 * index + 2}.test.js`,
          show("behind " + mock, `console.log(require("./one.cjs") === one, one.a, (await import("./one.cjs")).a);`),
        ],
      ]),
    ),
  },
  "a preload's mock that a test file replaces": {
    "two.js": `${counted("two")} export const a = "real";`,
    "user.js": `${counted("user")} export { a as seen } from "./two.js";`,
    "preload.js": `import { mock } from "bun:test"; globalThis.calls = 0; mock.module("./two.js", () => (calls++, { a: "preload" })); globalThis.user = await import("./user.js");`,
    ...Object.fromEntries(
      ["jest.doMock", "mock.module", "vi.doMock"].flatMap((mock, index) => [
        [
          `${2 * index + 1}.test.js`,
          show(
            mock,
            `${mock}("./two.js", () => ({ a: "file" })); console.log(require("./two.js").a, (await import("./two.js")).a);`,
            "test, jest, mock, vi",
          ),
        ],
        [
          `${2 * index + 2}.test.js`,
          show(
            "behind " + mock,
            `console.log(require("./two.js").a, (await import("./two.js")).a, user.seen, (await import("./user.js")).seen, calls);`,
          ),
        ],
      ]),
    ),
  },
  "a preload's mock over a loaded module that a test file replaces": {
    "dep.js": `${counted("dep")} export const which = "real";`,
    "dep.cjs": `${counted("depFile")} exports.which = "real";`,
    "user.js": `import { which } from "./dep.js"; import file from "./dep.cjs"; ${counted("user")} export const seen = () => [which, file.which, require("./dep.cjs").which].join();`,
    "preload.js": `import { mock } from "bun:test"; globalThis.user = await import("./user.js"); mock.module("./dep.js", () => ({ which: "preload" })); mock.module("./dep.cjs", () => ({ which: "preload" }));`,
    ...Object.fromEntries(
      ["jest.doMock", "mock.module", "vi.doMock"].flatMap((mock, index) => [
        [
          `${2 * index + 1}.test.js`,
          show(
            mock,
            `console.log(user.seen()); ${mock}("./dep.js", () => ({ which: "file" })); ${mock}("./dep.cjs", () => ({ which: "file" })); console.log((await import("./dep.js")).which, require("./dep.cjs").which);`,
            "test, jest, mock, vi",
          ),
        ],
        [
          `${2 * index + 2}.test.js`,
          show(
            "behind " + mock,
            `console.log(user.seen(), (await import("./dep.js")).which, require("./dep.cjs").which);`,
          ),
        ],
      ]),
    ),
  },
  "a preload's mock behind a reset and another mock": {
    "dep.js": `${counted("dep")} export const a = "real";`,
    "user.js": `import * as dep from "./dep.js"; ${counted("user")} export const seen = () => dep.a;`,
    "preload.js": `import { mock } from "bun:test"; globalThis.calls = 0; mock.module("./dep.js", () => (calls++, { a: "preload" })); globalThis.user = await import("./user.js");`,
    "1.test.js": show("resets, and imports nothing", `jest.resetModules();`, "test, jest"),
    "2.test.js": show(
      "mocks it again",
      `jest.doMock("./dep.js", () => ({ a: "file" })); console.log((await import("./dep.js")).a);`,
      "test, jest",
    ),
    "3.test.js": show(
      "the preload's",
      `console.log((await import("./dep.js")).a, user.seen(), (await import("./user.js")) === user, calls);`,
    ),
  },
};

const ways: [string, Record<string, string>][] = [
  ["as one program", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }],
  ["in layers", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:8" }],
  ["with the test files from disk", { BUN_AOT_TEST_FILES_FROM_DISK: "1", BUN_AOT_TESTS_NAME_WHAT_THEY_USE: "1" }],
];

async function runTests(directory: string, env: Record<string, string>, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--preload", "./preload.js", ...flags], directory, {
    ...bunEnv,
    ...env,
  });
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  return { printed: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")), results, exitCode };
}

for (const [name, files] of Object.entries(projects)) {
  for (const [way, env] of ways) {
    test.concurrent(`${name}, ${way}`, async () => {
      using dir = tempDir("preload-back", { "package.json": `{}`, ...files });
      const plain = await runTests(String(dir), {});
      expect(plain.exitCode).toBe(name.endsWith("fails") ? 1 : 0);
      expect(plain.printed.length).toBeGreaterThan(2);
      expect(await runTests(String(dir), env, "--aot")).toEqual(plain);
    });
  }
}
