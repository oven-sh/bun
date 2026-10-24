import { expect } from "bun:test";
import type { DirectoryTree } from "harness";
import { test } from "../supported";
import { describeTree, type TreeGraph } from "./describe";

const installed = "node_modules/pkg/index.js";
const typedVersion = "node_modules/pkg/index.full.ts";

const javascript = "export function add(a, b) {\n  return a + b + 1;\n}\n";
const typescript = "export function add(a: number, b: number): number {\n  return a + b + 1;\n}\n";
const pairImport = 'import type { Pair } from "./shapes.ts";\n';
const pairDeclaration = "export type Pair = [number, number];";

function createTree(packageFiles: DirectoryTree, typedCondition: string | null = "./index.full.ts"): DirectoryTree {
  const conditions = { types: "./index.d.ts", default: "./index.js" };
  return {
    "main.ts": 'import { add } from "pkg";\nconsole.log(add(1, 2));',
    "node_modules/pkg": {
      "package.json": JSON.stringify({
        name: "pkg",
        version: "1.0.0",
        exports: { ".": typedCondition === null ? conditions : { "full-types": typedCondition, ...conditions } },
      }),
      "index.d.ts": "export declare function add(a: number, b: number): number;",
      "index.js": javascript,
      ...packageFiles,
    },
  };
}

function expectChecked(graph: TreeGraph, typedSourcePath: string) {
  expect(graph.answer("main.ts", "pkg")).toBe(installed);
  expect(graph.file(installed)).toMatchObject({
    role: "Checked",
    isCompiled: true,
    typedSourcePath,
    erasureMismatch: null,
  });
  expect(graph.has(typedSourcePath)).toBe(false);
  expect(graph.file("main.ts").typeEdges).toEqual(["node_modules/pkg/index.d.ts"]);
}

function expectInferred(graph: TreeGraph, erasureMismatch: unknown) {
  expect(graph.answer("main.ts", "pkg")).toBe(installed);
  expect(graph.file(installed)).toMatchObject({
    role: "Inferred",
    isCompiled: true,
    typedSourcePath: null,
    erasureMismatch,
  });
  expect(graph.has(typedVersion)).toBe(false);
}

test("accepted", () => {
  using graph = describeTree(createTree({ "index.full.ts": typescript }), ["main.ts"]);
  expectChecked(graph, typedVersion);
  expect(graph.compiledFiles).toEqual([installed, "main.ts"]);
});

const rejectedVersions: [name: string, typedText: string, erasureMismatch: unknown][] = [
  ["different operator", typescript.replace("a + b + 1", "a - b + 1"), "Operator"],
  ["different name", typescript.replace("function add", "function sum"), "Name"],
  ["different literal", typescript.replace("+ 1", "+ 2"), "Literal"],
  ["syntax that emits code", "enum E { A }\n" + typescript, "EmitsCode"],
  ["extra statement", typescript.replace("  return", "  console.log(a);\n  return"), expect.any(String)],
  ["different node kind", typescript.replace("a + b + 1", "a + b + a"), expect.any(String)],
];

test.each(rejectedVersions)("rejected: %s", (_, typedText, erasureMismatch) => {
  using graph = describeTree(createTree({ "index.full.ts": typedText }), ["main.ts"]);
  expectInferred(graph, erasureMismatch);
});

test("full types with a syntax error", () => {
  using graph = describeTree(createTree({ "index.full.ts": "export function add(a: number {" }), ["main.ts"]);
  expectInferred(graph, expect.any(String));
});

test("no condition, no full types", () => {
  using graph = describeTree(createTree({ "index.full.ts": typescript }, null), ["main.ts"]);
  expectInferred(graph, null);
});

test("the condition names the installed file", () => {
  using graph = describeTree(createTree({}, "./index.js"), ["main.ts"]);
  expectInferred(graph, null);
});

test("type-only syntax is skipped", () => {
  const typedText =
    pairImport +
    "interface Local { n: number }\n" +
    typescript.replace("return a + b + 1;", "return (a as number) + b! + 1;");
  using graph = describeTree(createTree({ "index.full.ts": typedText, "shapes.ts": pairDeclaration }), ["main.ts"]);
  expectChecked(graph, typedVersion);
  expect(graph.compiledFiles).toEqual([installed, "main.ts"]);
  expect(graph.file(installed).typeEdges).toEqual(["node_modules/pkg/shapes.ts"]);
  expect(graph.file("node_modules/pkg/shapes.ts")).toMatchObject({ role: "Checked", isCompiled: false });
});

test("code specifiers resolve from the installed path, type specifiers from the typed path", () => {
  const oneImport = 'import { one } from "./one.js";\n';
  const packageFiles = {
    "index.js": oneImport + javascript.replace("+ 1", "+ one"),
    "one.js": "export const one = 1;",
    "typed/index.ts": pairImport + oneImport + typescript.replace("+ 1", "+ one"),
    "typed/shapes.ts": pairDeclaration,
    "shapes.ts": "export type Pair = string;",
  };
  using graph = describeTree(createTree(packageFiles, "./typed/index.ts"), ["main.ts"]);
  expectChecked(graph, "node_modules/pkg/typed/index.ts");
  expect(graph.answer(installed, "./one.js")).toBe("node_modules/pkg/one.js");
  expect(graph.file("node_modules/pkg/one.js")).toMatchObject({ role: "Inferred", isCompiled: true });
  expect(graph.file(installed).typeEdges).toContain("node_modules/pkg/typed/shapes.ts");
  expect(graph.has("node_modules/pkg/shapes.ts")).toBe(false);
});
