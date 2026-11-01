import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// A test file asks for a DOM by a comment, the command line by --environment, bunfig.toml by `environment`. `bun test` then loads a module of its own library that makes the window.
// That module is the runner's: no build compiles it with the files under test, and it requires modules of the library that the program may not hold.
const reads = `
  import { test } from "bun:test";
  import { event, observer, title } from "./page.js";
  test("reads", () => { console.log("|", import.meta.file + ":", typeof document, typeof window, title(), "|", event(), "|", observer()); });`;
const files = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "page.js": `
    export const title = () => (typeof document === "undefined" ? "no document" : document.title);
    // A built-in object of Bun that the window has too, and a name that only this window has.
    export const event = () => new Event("click").type;
    export const observer = () => typeof ResizeObserver;`,
  "node_modules/happy-dom/package.json": `{ "name": "happy-dom", "version": "1.0.0", "main": "index.cjs" }`,
  "node_modules/happy-dom/index.cjs": `
    exports.Window = class Window {
      constructor(options) {
        this.document = { title: "a page at " + options.url };
        this.window = this;
        this.Event = class Event {
          constructor(type) {
            this.type = "the window's " + type;
          }
        };
        this.ResizeObserver = class ResizeObserver {};
        this.happyDOM = { abort() {}, cancelAsync() {} };
      }
      close() {}
    };`,
  "none.test.js": reads,
  "vitest-happy-dom.test.js": `/** @vitest-environment happy-dom */` + reads,
  "jest-happy-dom.test.js": `/**\n * @jest-environment happy-dom\n */` + reads,
  "vitest-node.test.js": `// @vitest-environment node` + reads,
  "vitest-jsdom.test.js": `/** @vitest-environment jsdom */` + reads,
  "jest-jsdom.test.js": `/** @jest-environment jsdom */` + reads,
};

async function report(directory: string, flags: string[], words?: string) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "."], directory, env);
  const all = (stdout + "\n" + stderr).split("\n").map(line => line.replaceAll(directory, "<project>"));
  return {
    printed: all.filter(line => /^(\| |error: |warn: Cannot set up|note: to install)/.test(line)).sort(),
    counts: stderr.match(/^ *\d+ (pass|fail)$/gm)?.map(line => line.trim()),
    exitCode,
  };
}

for (const [title, flags, more] of [
  ["by a comment in the test file", [], {}],
  ["by a comment, each test file in a realm of its own", ["--isolate"], {}],
  ["on the command line", ["--environment=happy-dom"], {}],
  ["in bunfig.toml", [], { "bunfig.toml": `[test]\nenvironment = "happy-dom"\n` }],
] as const) {
  test(title, async () => {
    using directory = tempDir("dom-environment", { ...files, ...more });
    const plain = await report(String(directory), [...flags]);
    expect(plain.exitCode).toBe(0);
    expect(plain.printed).toContain(
      "| vitest-happy-dom.test.js: object object a page at http://localhost:3000 | the window's click | function",
    );
    expect(plain.printed).toContain("| vitest-node.test.js: undefined undefined no document | click | undefined");
    expect(plain.printed.join("\n")).toContain(`cannot find package "jsdom"`);
    expect(await report(String(directory), ["--aot", ...flags])).toEqual(plain);
    expect(await report(String(directory), ["--aot", ...flags], "TestRunLayers:2")).toEqual(plain);
  });
}

test("the build knows every name that the runner defines for a window", () => {
  const source = join(import.meta.dir, "../../src");
  const runner = readFileSync(join(source, "js/internal/test/environment.ts"), "utf8");
  const quoted = (text: string) => [...text.matchAll(/"([^"]+)"/g)].map(match => match[1]);
  const lists = [...runner.matchAll(/(?:const (?:SELF_)?KEYS = |windowProperties\(win, )\[([^\]]*)\]/g)];
  const defined = [
    ...lists.flatMap(match => quoted(match[1])),
    ...[...runner.matchAll(/addProperty\(globals, "([^"]+)"/g)].map(match => match[1]),
    "onerror",
    "onmessage",
  ];
  expect(lists).toHaveLength(4);
  const known = readFileSync(join(source, "aot/load/globals_of_a_window.rs"), "utf8");
  const names = quoted(known.slice(known.indexOf("const NAMES"), known.indexOf("];")));
  expect(names.toSorted()).toEqual([...new Set(defined)].toSorted());
});
