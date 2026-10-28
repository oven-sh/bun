import { expect } from "bun:test";
import type { DirectoryTree } from "harness";
import { test } from "../supported";
import { describeTree, type TreeGraph } from "./describe";

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    target: "ESNext",
    module: "Preserve",
    moduleResolution: "bundler",
    noEmit: true,
    types: [],
  },
  files: ["main.ts"],
});

const firstCopy = "x/node_modules/dep";
const secondCopy = "y/node_modules/dep";
const importer = 'import { v } from "dep";\nconsole.log(v);';

function describeCopies(firstFiles: DirectoryTree, secondFiles: DirectoryTree): TreeGraph {
  return describeTree(
    {
      "tsconfig.json": tsconfig,
      "main.ts": 'import "./x/one.ts";\nimport "./y/two.ts";',
      "x/one.ts": importer,
      "y/two.ts": importer,
      [firstCopy]: firstFiles,
      [secondCopy]: secondFiles,
    },
    ["main.ts"],
  );
}

function packageWithDeclarations(version: string): DirectoryTree {
  return {
    "package.json": JSON.stringify({ name: "dep", version, main: "./index.js", types: "./index.d.ts" }),
    "index.d.ts": "export declare const v: number;",
    "index.js": "exports.v = 1;",
  };
}

function getDeclarationFiles(graph: TreeGraph): string[] {
  return graph.paths.filter(path => path.endsWith("index.d.ts")).sort();
}

test("one declaration file, two JavaScript files", () => {
  using graph = describeCopies(packageWithDeclarations("1.0.0"), packageWithDeclarations("1.0.0"));
  expect(getDeclarationFiles(graph)).toEqual([`${firstCopy}/index.d.ts`]);
  expect(graph.file("x/one.ts").typeEdges).toEqual([`${firstCopy}/index.d.ts`]);
  expect(graph.file("y/two.ts").typeEdges).toEqual([`${firstCopy}/index.d.ts`]);
  expect(graph.answer("x/one.ts", "dep")).toBe(`${firstCopy}/index.js`);
  expect(graph.answer("y/two.ts", "dep")).toBe(`${secondCopy}/index.js`);
  expect(graph.compiledFiles).toEqual([
    `${firstCopy}/index.js`,
    "x/one.ts",
    `${secondCopy}/index.js`,
    "y/two.ts",
    "main.ts",
  ]);
});

test("two versions are two packages", () => {
  using graph = describeCopies(packageWithDeclarations("1.0.0"), packageWithDeclarations("2.0.0"));
  expect(getDeclarationFiles(graph)).toEqual([`${firstCopy}/index.d.ts`, `${secondCopy}/index.d.ts`]);
  expect(graph.file("y/two.ts").typeEdges).toEqual([`${secondCopy}/index.d.ts`]);
});

test("copies that ship TypeScript are not merged", () => {
  const packageWithSource = {
    "package.json": JSON.stringify({ name: "dep", version: "1.0.0", exports: "./index.ts" }),
    "index.ts": "export const v = 1;",
  };
  using graph = describeCopies(packageWithSource, packageWithSource);
  expect(graph.file(`${firstCopy}/index.ts`)).toMatchObject({ role: "Checked", isCompiled: true });
  expect(graph.file(`${secondCopy}/index.ts`)).toMatchObject({ role: "Checked", isCompiled: true });
  expect(graph.file("x/one.ts")).toMatchObject({
    typeEdges: [`${firstCopy}/index.ts`],
    codeEdges: [`${firstCopy}/index.ts`],
  });
  expect(graph.file("y/two.ts")).toMatchObject({
    typeEdges: [`${secondCopy}/index.ts`],
    codeEdges: [`${secondCopy}/index.ts`],
  });
});
