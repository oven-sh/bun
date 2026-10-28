import { expect } from "bun:test";
import type { DirectoryTree } from "harness";
import { describe, test } from "../supported";
import { describeTree } from "./describe";

const box = {
  "box.js": "export class Box { #value; constructor(value) { this.#value = value; } get() { return this.#value; } }\n",
  "box.aot.ts":
    "export class Box { #value: number; constructor(value: number) { this.#value = value; } get(): number { return this.#value; } }\n",
  "box.d.ts": "export declare class Box { #private; constructor(value: number); get(): number; }\n",
  "index.js": 'export { Box } from "./box.js";\nexport function open(box) { return box.get(); }\n',
  "index.aot.ts":
    'import { Box } from "./box.aot.ts";\nexport { Box };\nexport function open(box: Box): number { return box.get(); }\n',
  "index.d.ts": 'import { Box } from "./box.js";\nexport { Box };\nexport declare function open(box: Box): number;\n',
};

function createTree(main: string, exports: unknown, files: DirectoryTree = box): DirectoryTree {
  return {
    "main.ts": main,
    "tsconfig.json": JSON.stringify({
      compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler", target: "esnext", types: [] },
    }),
    "node_modules/pkg": {
      "package.json": JSON.stringify({ name: "pkg", version: "1.0.0", type: "module", exports }),
      ...files,
    },
  };
}

const inPackage = (name: string) => `node_modules/pkg/${name}`;

describe("the file under the aot condition is the module, for the code and for the type checker", () => {
  test.each([
    ["aot before types", { aot: "./index.aot.ts", types: "./index.d.ts", default: "./index.js" }],
    ["types before aot", { types: "./index.d.ts", aot: "./index.aot.ts", default: "./index.js" }],
    ["aot below import", { types: "./index.d.ts", import: { aot: "./index.aot.ts", default: "./index.js" } }],
    ["types and aot below import", { import: { types: "./index.d.ts", aot: "./index.aot.ts", default: "./index.js" } }],
  ])("%s", (_, conditions) => {
    using graph = describeTree(createTree('import { open } from "pkg";\nopen;', { ".": conditions }), ["main.ts"]);
    expect(graph.diagnostics).toEqual([]);
    expect(graph.answer("main.ts", "pkg")).toBe(inPackage("index.aot.ts"));
    expect(graph.file("main.ts").typeEdges).toEqual([inPackage("index.aot.ts")]);
    expect(graph.file(inPackage("index.aot.ts"))).toMatchObject({
      role: "Checked",
      isCompiled: true,
      isAotSource: true,
    });
    for (const name of ["index.js", "index.d.ts", "box.js", "box.d.ts"]) {
      expect(graph.has(inPackage(name))).toBe(false);
    }
  });

  test("JavaScript under the condition brings the declarations beside it, not those under types", () => {
    const files = {
      "index.mjs": "export const which = 1;\n",
      "index.d.mts": "export declare const which: number;\n",
      "aot/index.mjs": "export const which = 1;\n",
      "aot/index.d.mts": "export declare const which: number;\n",
    };
    const exports = { ".": { types: "./index.d.mts", default: { aot: "./aot/index.mjs", default: "./index.mjs" } } };
    using graph = describeTree(createTree('import { which } from "pkg";\nwhich;', exports, files), ["main.ts"]);
    expect(graph.diagnostics).toEqual([]);
    expect(graph.answer("main.ts", "pkg")).toBe(inPackage("aot/index.mjs"));
    expect(graph.file("main.ts").typeEdges).toEqual([inPackage("aot/index.d.mts")]);
    expect(graph.has(inPackage("index.d.mts"))).toBe(false);
  });

  test("an import of types alone reads it too", () => {
    const main = 'import type { Box } from "pkg";\nexport type Copy = Box;';
    const exports = { ".": { types: "./index.d.ts", aot: "./index.aot.ts", default: "./index.js" } };
    using graph = describeTree(createTree(main, exports), ["main.ts"]);
    expect(graph.diagnostics).toEqual([]);
    expect(graph.file("main.ts").typeEdges).toEqual([inPackage("index.aot.ts")]);
    expect(graph.has(inPackage("index.d.ts"))).toBe(false);
  });

  test("a class with a #private member that comes through two subpaths has one declaration", () => {
    const main = `import { open, Box as FromRoot } from "pkg";
import { Box } from "pkg/box";
const box: FromRoot = new Box(1);
const other: Box = new FromRoot(2);
open(box) + open(other);`;
    const exports = {
      ".": { types: "./index.d.ts", aot: "./index.aot.ts", default: "./index.js" },
      "./box": { types: "./box.d.ts", aot: "./box.aot.ts", default: "./box.js" },
    };
    using graph = describeTree(createTree(main, exports), ["main.ts"]);
    expect(graph.diagnostics).toEqual([]);
    expect(graph.answer("main.ts", "pkg/box")).toBe(inPackage("box.aot.ts"));
    expect(graph.file("main.ts").typeEdges.toSorted()).toEqual([inPackage("box.aot.ts"), inPackage("index.aot.ts")]);
  });

  test("a pattern and an entry of imports", () => {
    const files = {
      "deep/a.js": 'export { inner } from "#inner";\n',
      "deep/a.aot.ts": 'export { inner } from "#inner";\n',
      "inner.js": "export const inner = 1;\n",
      "inner.aot.ts": "export const inner: number = 1;\n",
    };
    const tree = createTree('import { inner } from "pkg/deep/a";\ninner;', {
      "./deep/*": { aot: "./deep/*.aot.ts", default: "./deep/*.js" },
    });
    const manifest = JSON.parse((tree["node_modules/pkg"] as Record<string, string>)["package.json"]);
    manifest.imports = { "#inner": { aot: "./inner.aot.ts", default: "./inner.js" } };
    tree["node_modules/pkg"] = { "package.json": JSON.stringify(manifest), ...files };
    using graph = describeTree(tree, ["main.ts"]);
    expect(graph.diagnostics).toEqual([]);
    expect(graph.answer("main.ts", "pkg/deep/a")).toBe(inPackage("deep/a.aot.ts"));
    expect(graph.answer(inPackage("deep/a.aot.ts"), "#inner")).toBe(inPackage("inner.aot.ts"));
  });

  test("an .mjs specifier finds the .mts file beside an aot file", () => {
    const files = {
      "index.mjs": 'export { inner } from "./inner.mjs";\n',
      "aot/index.mjs": 'export { inner } from "./inner.mjs";\n',
      "inner.mjs": "export const inner = 1;\n",
      "aot/inner.mts": "export const inner: number = 1;\n",
    };
    const exports = { ".": { aot: "./aot/index.mjs", default: "./index.mjs" } };
    using graph = describeTree(createTree('import { inner } from "pkg";\ninner;', exports, files), ["main.ts"]);
    expect(graph.answer(inPackage("aot/index.mjs"), "./inner.mjs")).toBe(inPackage("aot/inner.mts"));
    expect(graph.file(inPackage("aot/inner.mts"))).toMatchObject({ role: "Checked", isAotSource: true });
  });
});

test("where require has no aot condition, its types are read as always", () => {
  const exports = {
    ".": { types: "./index.d.ts", import: { aot: "./index.aot.ts", default: "./index.js" }, require: "./index.cjs" },
  };
  const files = { ...box, "index.cjs": "exports.open = box => box.get();\n" };
  using graph = describeTree(createTree('const { open } = require("pkg");\nopen;', exports, files), ["main.ts"]);
  expect(graph.answer("main.ts", "pkg", "require")).toBe(inPackage("index.cjs"));
  expect(graph.has(inPackage("index.aot.ts"))).toBe(false);
});

test("a package without the condition is loaded as always", () => {
  const exports = { ".": { types: "./index.d.ts", default: "./index.js" } };
  using graph = describeTree(createTree('import { open } from "pkg";\nopen;', exports), ["main.ts"]);
  expect(graph.diagnostics).toEqual([]);
  expect(graph.answer("main.ts", "pkg")).toBe(inPackage("index.js"));
  expect(graph.file(inPackage("index.js"))).toMatchObject({ role: "Inferred", isCompiled: true, isAotSource: false });
  expect(graph.file("main.ts").typeEdges).toEqual([inPackage("index.d.ts")]);
  expect(graph.has(inPackage("index.aot.ts"))).toBe(false);
});
