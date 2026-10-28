import { expect } from "bun:test";
import type { DirectoryTree } from "harness";
import { test } from "../supported";
import { describeTree, type TreeGraph } from "./describe";

const compilerOptions = {
  strict: true,
  target: "ESNext",
  module: "Preserve",
  moduleResolution: "bundler",
  noEmit: true,
  types: [],
};

function tsconfig(extraOptions: object = {}, files?: string[]): string {
  return JSON.stringify({ compilerOptions: { ...compilerOptions, ...extraOptions }, files });
}

function appTsconfig(extraOptions: object = {}): string {
  return tsconfig(extraOptions, ["main.ts"]);
}

test("the same alias in two packages", () => {
  using graph = describeTree(
    {
      "app/tsconfig.json": appTsconfig({ paths: { "@/*": ["./src/*"] } }),
      "app/main.ts":
        'import { four } from "../lib/index.ts";\nimport { name } from "@/util";\nconsole.log(name, four());',
      "app/src/util.ts": 'export const name = "app";',
      "lib/tsconfig.json": tsconfig({ paths: { "@/*": ["./src/*"] } }),
      "lib/index.ts": 'import { twice } from "@/util";\nexport function four(): number { return twice(2); }',
      "lib/src/util.ts": "export function twice(n: number): number { return n * 2; }",
    },
    ["app/main.ts"],
  );
  expect(graph.diagnostics).toEqual([]);
  expect(graph.file("app/main.ts")).toMatchObject({
    typeEdges: ["lib/index.ts", "app/src/util.ts"],
    codeEdges: ["lib/index.ts", "app/src/util.ts"],
  });
  expect(graph.file("lib/index.ts")).toMatchObject({ typeEdges: ["lib/src/util.ts"], codeEdges: ["lib/src/util.ts"] });
  expect(graph.compiledFiles).toEqual(["lib/src/util.ts", "lib/index.ts", "app/src/util.ts", "app/main.ts"]);
});

test("an alias only the other package has", () => {
  using graph = describeTree(
    {
      "app/tsconfig.json": appTsconfig(),
      "app/main.ts": 'import { four } from "../lib/index.ts";\nconsole.log(four());',
      "lib/tsconfig.json": tsconfig({ paths: { "@util": ["./src/util.ts"] } }),
      "lib/index.ts": 'import { twice } from "@util";\nexport function four(): number { return twice(2); }',
      "lib/src/util.ts": "export function twice(n: number): number { return n * 2; }",
    },
    ["app/main.ts"],
  );
  expect(graph.diagnostics).toEqual([]);
  expect(graph.file("lib/index.ts")).toMatchObject({ typeEdges: ["lib/src/util.ts"], codeEdges: ["lib/src/util.ts"] });
});

// TODO: a name that only the outer tsconfig.json's paths know is an edge of a file below the inner one.
test.todo("the nearest governs alone", () => {
  using graph = describeTree(
    {
      "app/tsconfig.json": appTsconfig({ paths: { "the-app": ["./src/api.ts"] } }),
      "app/main.ts": 'import { next } from "./mods/one.ts";\nnext({ n: 1 });',
      "app/src/api.ts": "export interface Settings { n: number }",
      "app/mods/tsconfig.json": tsconfig(),
      "app/mods/one.ts":
        'import type { Settings } from "the-app";\nexport function next(s: Settings): number { return s.n + 1; }',
    },
    ["app/main.ts"],
  );
  // The unresolved name is the checker's TS2307. The load reports nothing.
  expect(graph.diagnostics).toEqual([]);
  expect(graph.file("app/mods/one.ts").typeEdges).toEqual([]);
  expect(graph.has("app/src/api.ts")).toBe(false);
});

const dependency = "app/node_modules/dep";
const edgesUnderProgramOptions = ["app/shared.ts", `${dependency}/inner.ts`];

function describeDependency(dependencyTsconfig?: string): TreeGraph {
  const files: DirectoryTree = {
    "app/tsconfig.json": appTsconfig({ paths: { "@shared": ["./shared.ts"] } }),
    "app/main.ts": 'import { v } from "dep";\nconsole.log(v);',
    "app/shared.ts": "export type Shared = number;",
    [`${dependency}/package.json`]: JSON.stringify({ name: "dep", version: "1.0.0", exports: "./index.ts" }),
    [`${dependency}/index.ts`]:
      'import type { Shared } from "@shared";\nimport { inner } from "./inner.ts";\nexport const v: Shared = inner;',
    [`${dependency}/inner.ts`]: "export const inner = 1;",
  };
  if (dependencyTsconfig !== undefined) files[`${dependency}/tsconfig.json`] = dependencyTsconfig;
  return describeTree(files, ["app/main.ts"]);
}

test.each([
  ["unterminated", '{ "compilerOptions": {'],
  ["extends a missing file", '{ "extends": "./does-not-exist.json" }'],
])("a broken configuration in a dependency: %s", (_, text) => {
  using graph = describeDependency(text);
  expect(graph.diagnostics).toEqual([]);
  expect(graph.file(`${dependency}/index.ts`)).toMatchObject({ role: "Checked", typeEdges: edgesUnderProgramOptions });
});

// TODO: the file of the dependency is described otherwise than here.
test.todo("a sound configuration in a dependency governs it", () => {
  using graph = describeDependency(tsconfig());
  expect(graph.diagnostics).toEqual([]);
  expect(graph.file(`${dependency}/index.ts`)).toMatchObject({
    role: "Checked",
    typeEdges: [`${dependency}/inner.ts`],
  });
});

test("a dependency without a configuration", () => {
  using graph = describeDependency();
  expect(graph.diagnostics).toEqual([]);
  expect(graph.file(`${dependency}/index.ts`)).toMatchObject({ role: "Checked", typeEdges: edgesUnderProgramOptions });
});
