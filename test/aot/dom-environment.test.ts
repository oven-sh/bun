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

async function report(directory: string, flags: string[]) {
  const env = bunEnv;
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
  });
}

// Under --isolate the window lives in a realm of its own. Its package runs from source there, and what the build compiled runs compiled.
for (const [name, main] of [
  [
    "jsdom",
    `
      const { next } = require("words");
      class Target {
        addEventListener() {}
        removeEventListener() {}
        dispatchEvent() {}
      }
      exports.JSDOM = class JSDOM {
        window = Object.assign(new Target(), {
          EventTarget: Target, AbortController, AbortSignal, Blob, FormData,
          document: { title: "page " + next() },
          close() {},
        });
      };`,
  ],
  [
    "happy-dom",
    `
      const { next } = require("words");
      exports.Window = class Window {
        document = { title: "page " + next() };
        window = this;
        happyDOM = { abort() {}, cancelAsync() {} };
        close() {}
      };`,
  ],
] as const) {
  test(`a compiled dependency of ${name}'s window runs compiled`, async () => {
    const uses = `import { test } from "bun:test";\ntest("a", () => console.log("|", typeof document, globalThis.document?.title));`;
    const dom = `/** @vitest-environment ${name} */`;
    using directory = tempDir("dom-environment-dependency", {
      "package.json": files["package.json"],
      [`node_modules/${name}/package.json`]: JSON.stringify({ name, version: "30.0.0", main: "index.cjs" }),
      [`node_modules/${name}/index.cjs`]: main,
      "node_modules/words/package.json": `{ "name": "words", "version": "1.0.0", "type": "module", "main": "index.js" }`,
      "node_modules/words/index.js": `let count = 0;\nexport const next = () => ++count;`,
      "a.test.js": `import { next } from "words";\nconsole.log("| a counts", next());\n` + uses,
      "b.test.js": dom + uses,
      "c.test.js": dom + uses,
    });
    const report = async (...flags: string[]) => {
      const command = [bunExe(), "test", "--isolate", ...flags, "./a.test.js", "./b.test.js", "./c.test.js"];
      const { stdout, stderr, exitCode } = await run(command, String(directory), { ...bunEnv, BUN_AOT_VERBOSE: "1" });
      const lines = (stdout + "\n" + stderr).split("\n");
      return {
        printed: lines.filter(line => line.startsWith("| ")),
        compiled: lines.filter(line => line.includes("[aot] module: ") && line.includes("words")).length,
        refused: lines.filter(line => line.includes("can't be imported in another realm")).length,
        exitCode,
      };
    };
    const plain = await report();
    expect(plain).toMatchObject({ compiled: 0, refused: 0, exitCode: 0 });
    const aot = await report("--aot");
    // What the window's package requires: a.test.js has its module from its own imports.
    expect(aot).toEqual({ ...plain, compiled: 1 });
  });
}

// happy-dom's window has the binary data classes of its realm. There the runner makes the test file's binary data instances of them.
test("a compiled dependency of happy-dom's window accepts the test file's binary data", async () => {
  const dom = `/** @vitest-environment happy-dom */`;
  using directory = tempDir("dom-environment-binary-data", {
    "package.json": files["package.json"],
    "node_modules/happy-dom/package.json": `{ "name": "happy-dom", "version": "30.0.0", "main": "index.cjs" }`,
    "node_modules/happy-dom/index.cjs": `
      const { classesOf, count } = require("kinds");
      exports.Window = class Window {
        document = { title: "page " + count() };
        window = this;
        classesOf = classesOf;
        ArrayBuffer = ArrayBuffer; Uint8Array = Uint8Array; Uint16Array = Uint16Array; Uint32Array = Uint32Array;
        Uint8ClampedArray = Uint8ClampedArray; Int8Array = Int8Array; Int16Array = Int16Array; Int32Array = Int32Array;
        Float32Array = Float32Array; Float64Array = Float64Array;
        happyDOM = { abort() {}, cancelAsync() {} };
        close() {}
      };`,
    "node_modules/kinds/package.json": `{ "name": "kinds", "version": "1.0.0", "type": "module", "main": "index.js" }`,
    "node_modules/kinds/index.js": `
      let windows = 0;
      export const count = () => ++windows;
      class Bytes extends Uint8Array {}
      class Plain {}
      const isOneOf = (value, classes) => classes.map(one => Number(value instanceof one)).join("");
      export function classesOf(value) {
        let bytes = 0;
        for (let i = 0; i < 100; i++) if (value instanceof Uint8Array) bytes++;
        return [
          Number(value instanceof ArrayBuffer), bytes, Number(value instanceof Uint16Array), Number(value instanceof Uint32Array),
          Number(value instanceof Uint8ClampedArray), Number(value instanceof Int8Array), Number(value instanceof Int16Array),
          Number(value instanceof Int32Array), Number(value instanceof Float32Array), Number(value instanceof Float64Array),
          Number(value instanceof BigInt64Array), Number(value instanceof DataView), Number(value instanceof SharedArrayBuffer),
          Number(value instanceof Bytes), Number(value instanceof Plain), Number(value instanceof Array), Number(value instanceof Map),
          Number(value instanceof Object), isOneOf(value, [Uint8Array, ArrayBuffer, Float64Array, DataView, Bytes]),
        ].join(" ");
      }
      console.log("| own", classesOf(new Uint8Array(1)), "|", classesOf(new Bytes(1)), "|", classesOf(new ArrayBuffer(1)), "|", classesOf({}));`,
    "shared.js": `
      // The classes are the window's here. structuredClone() gives data of this file's realm.
      const of = constructor => structuredClone(new constructor(1));
      const bytes = new TextEncoder().encode("a");
      export const values = {
        buffer: Buffer.from("a"), bytes, arrayBuffer: of(ArrayBuffer), shared: new SharedArrayBuffer(1), view: new DataView(bytes.buffer),
        words: of(Uint16Array), longs: of(Uint32Array), clamped: of(Uint8ClampedArray), signed: of(Int8Array), shorts: of(Int16Array),
        ints: of(Int32Array), floats: of(Float32Array), doubles: of(Float64Array), big: new BigInt64Array(1), ofWindow: new Uint8Array(1),
        bare: Object.create(null), list: [], map: new Map(), text: "a", nothing: null,
        detached: Object.setPrototypeOf(new TextEncoder().encode("a"), null), imitation: Object.create(Object.getPrototypeOf(bytes)),
        proxy: new Proxy(bytes, {}), below: Object.create(bytes),
      };
      export const show = () => Object.entries(values).map(([name, value]) => "\\n| " + name + " " + classesOf(value)).join("");`,
    "a.test.js":
      dom +
      `import { test } from "bun:test";\nimport { show } from "./shared.js";\nimport { classesOf as own } from "kinds";\ntest("a", () => console.log("|", document.title, own(Buffer.from("a")), show()));`,
    "b.test.js": `import { test } from "bun:test";\nimport { classesOf } from "kinds";\ntest("b", () => console.log("|", classesOf(Buffer.from("a")), classesOf(new Uint8Array(1))));`,
    "c.test.js":
      dom +
      `import { test } from "bun:test";\nimport { show } from "./shared.js";\ntest("c", () => console.log("|", document.title, show()));`,
  });
  const report = async (...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run(
      [bunExe(), "test", "--isolate", ...flags, "./a.test.js", "./b.test.js", "./c.test.js"],
      String(directory),
      { ...bunEnv, BUN_AOT_VERBOSE: "1" },
    );
    return {
      printed: (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("| ")),
      compiled: stderr.split("\n").filter(line => line.includes("[aot] module: ") && line.includes("kinds")).length,
      exitCode,
    };
  };
  const plain = await report();
  expect(plain).toMatchObject({ compiled: 0, exitCode: 0 });
  expect(plain.printed).toHaveLength(54);
  expect(plain.printed).toContain("| buffer 0 100 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 10000");
  expect(await report("--aot")).toEqual({ ...plain, compiled: 1 });
});

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
