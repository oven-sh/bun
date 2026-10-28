import { expect } from "bun:test";
import { test } from "../supported";
import { describeTree, type TreeFile, type TreeGraph } from "./describe";

type Role = TreeFile["role"];

function rolesOf(graph: TreeGraph): Record<string, Role> {
  return Object.fromEntries(graph.paths.map(path => [path, graph.file(path).role]));
}

const importedFiles: [path: string, text: string, role: Role][] = [
  ["a.ts", "export {};", "Checked"],
  ["b.tsx", "export {};", "Checked"],
  ["c.mts", "export {};", "Checked"],
  ["d.cts", "export {};", "Checked"],
  ["e.js", "export {};", "Inferred"],
  ["f.jsx", "export {};", "Inferred"],
  ["g.mjs", "export {};", "Inferred"],
  ["h.cjs", "export {};", "Inferred"],
  ["i.json", "{}", "Inferred"],
  ["j.d.ts", "export declare const x: number;", "TypesOnly"],
  ["k.d.mts", "export declare const x: number;", "TypesOnly"],
  ["l.d.cts", "export declare const x: number;", "TypesOnly"],
];

test("each extension", () => {
  using graph = describeTree(
    {
      "main.ts": importedFiles.map(([path]) => `import "./${path}";`).join("\n"),
      ...Object.fromEntries(importedFiles.map(([path, text]) => [path, text])),
    },
    ["main.ts"],
  );

  expect(rolesOf(graph)).toEqual({
    "main.ts": "Checked",
    ...Object.fromEntries(importedFiles.map(([path, , role]) => [path, role])),
  });
  expect(graph.compiledFiles).toEqual([
    ...importedFiles.filter(([, , role]) => role !== "TypesOnly").map(([path]) => path),
    "main.ts",
  ]);
  expect(graph.answer("main.ts", "./j.d.ts")).toBe("j.d.ts");
  expect(graph.raw.files.filter(file => file.loader !== 0)).toEqual([]);

  const libraries = graph.raw.files.filter(file => file.isLibrary);
  expect(libraries.length).toBeGreaterThan(0);
  expect(libraries.filter(file => file.role !== "TypesOnly" || file.isCompiled)).toEqual([]);
});

const requireCalls = 'require("./lib.js");\nrequire("./typed.ts");';
const importStatements = 'import "./lib.js";\nimport "./typed.ts";';

test.each([
  ["main.js", requireCalls],
  ["main.jsx", requireCalls],
  ["main.mjs", importStatements],
  ["main.cjs", requireCalls],
])("a JavaScript entry point without allowJs: %s", (entryPoint, text) => {
  using graph = describeTree(
    {
      "tsconfig.json": '{ "compilerOptions": { "allowJs": false } }',
      "other.ts": "export {};",
      [entryPoint]: text,
      "lib.js": "",
      "typed.ts": "export const list: Array<number> = [];",
    },
    [entryPoint],
  );

  expect(rolesOf(graph)).toEqual({
    "other.ts": "Checked",
    [entryPoint]: "Inferred",
    "lib.js": "Inferred",
    "typed.ts": "Checked",
  });
  expect(graph.compiledFiles).toEqual(["lib.js", "typed.ts", entryPoint]);
  expect(graph.entryPoints).toEqual([entryPoint]);
  expect(graph.raw.files.some(file => file.isLibrary)).toBe(true);
});

test("a file only a type edge reaches", () => {
  using graph = describeTree(
    {
      "main.ts": 'import type { T } from "./shape.ts";\nexport const t: T = 1;',
      "shape.ts": "export type T = number;",
    },
    ["main.ts"],
  );

  expect(graph.file("shape.ts")).toMatchObject({ role: "Checked", isCompiled: false });
  expect(graph.file("main.ts")).toMatchObject({ typeEdges: ["shape.ts"], sites: [], codeEdges: [] });
});

test.each([
  ["tool", "./lib.js"],
  ["bin/nested", "../lib.js"],
  ["with.dots.in-its-name", "./lib.js"],
])("an entry point without an extension: %s", (entryPoint, specifier) => {
  using graph = describeTree(
    {
      [entryPoint]: `#!/usr/bin/env bun\nconst lib = require("${specifier}");\n`,
      "lib.js": "export {};",
    },
    [entryPoint],
  );

  expect(graph.file(entryPoint).role).toBe("Inferred");
  expect(graph.compiledFiles).toEqual(["lib.js", entryPoint]);
});

test("an entry point that does not exist", () => {
  using graph = describeTree({ "main.ts": "" }, ["main.ts", "none.ts"]);

  expect(graph.raw.unresolvedEntryPoints).toEqual([{ index: 1, failure: "ModuleNotFound" }]);
  expect(graph.raw.files).toEqual([]);
});
