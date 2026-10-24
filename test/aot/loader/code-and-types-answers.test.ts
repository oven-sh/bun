import { expect } from "bun:test";
import type { DirectoryTree } from "harness";
import { test } from "../supported";
import { describeTree, type DescribeOptions, type TreeGraph } from "./describe";

const compilerOptions = {
  strict: true,
  target: "ESNext",
  module: "Preserve",
  moduleResolution: "bundler",
  noEmit: true,
  types: [],
};

function tsconfig(extraOptions: object = {}): string {
  return JSON.stringify({ compilerOptions: { ...compilerOptions, ...extraOptions }, files: ["main.ts"] });
}

function manifest(name: string, fields: object): string {
  return JSON.stringify({ name, version: "1.0.0", ...fields });
}

function describeProject(files: DirectoryTree, options?: DescribeOptions): TreeGraph {
  return describeTree({ "tsconfig.json": tsconfig(), ...files }, ["main.ts"], options);
}

function getSiteAnswers(graph: TreeGraph, path: string): [specifier: string | null, answer: string][] {
  return graph.file(path).sites.map(site => [site.specifier, site.answer]);
}

const typedPackage = {
  "node_modules/typed/package.json": manifest("typed", { main: "./index.js", types: "./index.d.ts" }),
  "node_modules/typed/index.js": "exports.value = 1;",
  "node_modules/typed/index.d.ts": "export declare const value: number;",
};

test("declarations beside JavaScript", () => {
  using graph = describeProject({
    "main.ts": 'import { value } from "typed";\nconsole.log(value);',
    ...typedPackage,
  });
  expect(graph.file("main.ts")).toMatchObject({
    typeEdges: ["node_modules/typed/index.d.ts"],
    codeEdges: ["node_modules/typed/index.js"],
  });
  expect(graph.answer("main.ts", "typed")).toBe("node_modules/typed/index.js");
  expect(graph.file("node_modules/typed/index.d.ts").role).toBe("TypesOnly");
  expect(graph.file("node_modules/typed/index.js").role).toBe("Inferred");
  expect(graph.compiledFiles).toEqual(["node_modules/typed/index.js", "main.ts"]);
});

test("@types", () => {
  using graph = describeProject({
    "main.ts": 'import "plain";',
    "node_modules/plain/package.json": manifest("plain", { main: "./index.js" }),
    "node_modules/plain/index.js": "",
    "node_modules/@types/plain/package.json": manifest("@types/plain", { types: "./index.d.ts" }),
    "node_modules/@types/plain/index.d.ts": "export {};",
  });
  expect(graph.file("main.ts").typeEdges).toEqual(["node_modules/@types/plain/index.d.ts"]);
  expect(graph.answer("main.ts", "plain")).toBe("node_modules/plain/index.js");
});

test("a bun condition that names TypeScript", () => {
  using graph = describeProject({
    "main.ts": 'import "source-first";',
    "node_modules/source-first/package.json": manifest("source-first", {
      exports: { ".": { bun: "./src/index.ts", types: "./dist/index.d.ts", default: "./dist/index.js" } },
    }),
    "node_modules/source-first/src/index.ts": "export {};",
    "node_modules/source-first/dist/index.d.ts": "export {};",
    "node_modules/source-first/dist/index.js": "export {};",
  });
  expect(graph.answer("main.ts", "source-first")).toBe("node_modules/source-first/src/index.ts");
  expect(graph.file("node_modules/source-first/src/index.ts")).toMatchObject({ role: "Checked", isCompiled: true });
  expect(graph.file("main.ts").typeEdges).toEqual(["node_modules/source-first/dist/index.d.ts"]);
  expect(graph.has("node_modules/source-first/dist/index.js")).toBe(false);
});

test("a condition of the build that names TypeScript", () => {
  const files = {
    "main.ts": 'import "source-first";\nimport "only-sources";',
    "node_modules/source-first/package.json": manifest("source-first", {
      exports: { ".": { source: "./src/index.ts", types: "./dist/index.d.ts", default: "./dist/index.js" } },
    }),
    "node_modules/source-first/src/index.ts": "export {};",
    "node_modules/source-first/dist/index.d.ts": "export {};",
    "node_modules/source-first/dist/index.js": "export {};",
    "node_modules/only-sources/package.json": manifest("only-sources", { exports: { ".": { source: "./index.ts" } } }),
    "node_modules/only-sources/index.ts": "export {};",
  };
  using graph = describeProject(files, { conditions: ["source"] });
  const sources = ["node_modules/source-first/src/index.ts", "node_modules/only-sources/index.ts"];
  expect(graph.file("main.ts")).toMatchObject({ typeEdges: sources, codeEdges: sources });
  expect(graph.has("node_modules/source-first/dist/index.d.ts")).toBe(false);
});

test("an untyped package without allowJs", () => {
  using graph = describeProject({
    "main.ts": 'import "untyped";\nimport "./local.js";',
    "local.js": "",
    "node_modules/untyped/package.json": manifest("untyped", { main: "./index.js" }),
    "node_modules/untyped/index.js": "",
  });
  expect(graph.file("main.ts")).toMatchObject({
    typeEdges: [],
    codeEdges: ["node_modules/untyped/index.js", "local.js"],
  });
  expect(graph.file("node_modules/untyped/index.js")).toMatchObject({ role: "Inferred", isCompiled: true });
  expect(graph.file("local.js")).toMatchObject({ role: "Inferred", isCompiled: true });

  using graphWithAllowJs = describeProject({
    "tsconfig.json": tsconfig({ allowJs: true }),
    "main.ts": 'import "./local.js";',
    "local.js": "",
  });
  expect(graphWithAllowJs.file("main.ts")).toMatchObject({ typeEdges: ["local.js"], codeEdges: ["local.js"] });
  expect(graphWithAllowJs.paths.filter(path => path === "local.js")).toEqual(["local.js"]);
});

test("import and require of a dual package", () => {
  using graph = describeProject({
    "main.ts": 'import "dual";\nrequire("dual");',
    "node_modules/dual/package.json": manifest("dual", {
      exports: { ".": { import: "./esm.mjs", require: "./cjs.cjs" } },
    }),
    "node_modules/dual/esm.mjs": "",
    "node_modules/dual/cjs.cjs": "",
  });
  expect(graph.answer("main.ts", "dual", "import")).toBe("node_modules/dual/esm.mjs");
  expect(graph.answer("main.ts", "dual", "require")).toBe("node_modules/dual/cjs.cjs");
  expect(graph.compiledFiles).toEqual(["node_modules/dual/esm.mjs", "node_modules/dual/cjs.cjs", "main.ts"]);
});

test("one file reached by two names", () => {
  using graph = describeProject(
    {
      "main.ts": 'import { n } from "./linked/util.ts";\nconsole.log(n);',
      "real/util.ts": "export const n = 1;",
    },
    { links: { linked: "real" } },
  );
  // tsc keeps the link's name for a relative import. The file is named as bun run names the module.
  expect(graph.answer("main.ts", "./linked/util.ts")).toBe("real/util.ts");
  expect(graph.file("main.ts").typeEdges).toEqual(["real/util.ts"]);
  expect(graph.has("linked/util.ts")).toBe(false);
});

test("an inferred file sees what runs", () => {
  using graph = describeTree({ "main.js": 'import { value } from "typed";', ...typedPackage }, ["main.js"]);
  expect(graph.file("main.js")).toMatchObject({ codeEdges: ["node_modules/typed/index.js"], typeEdges: [] });
  expect(graph.file("node_modules/typed/index.js").typeEdges).toEqual(["node_modules/typed/index.d.ts"]);
});

const answersWithoutFile: [specifier: string, answer: string][] = [
  ["node:fs", "builtin:node:fs"],
  ["https://example.com/mod.js", "external"],
  ["//example.com/mod.js", "external"],
  ["data:text/javascript,export {}", "external"],
  ["./missing.ts", "not found (ModuleNotFound)"],
  ["missing-package", "not found (PackageNotFound)"],
  // bun run says "Cannot find package" only for a bare name without a slash.
  ["@scope/missing", "not found (ModuleNotFound)"],
  ["node:no-such-module", "not found (BuiltinModuleNotFound)"],
  ["./main.ts?query", "not found (QueryString)"],
];

test("answers that are no file", () => {
  const imports = answersWithoutFile.map(([specifier]) => `import "${specifier}";`);
  using graph = describeProject({ "main.ts": [...imports, "import(process.argv[2]);"].join("\n") });
  expect(getSiteAnswers(graph, "main.ts")).toEqual([...answersWithoutFile, [null, "computed"]]);
  expect(graph.file("main.ts").codeEdges).toEqual([]);
  expect(graph.compiledFiles).toEqual(["main.ts"]);

  using graphWithConstantName = describeProject({
    "main.ts": 'const name = "./other.ts";\nimport(name);',
    "other.ts": "export {};",
  });
  expect(getSiteAnswers(graphWithConstantName, "main.ts")).toEqual([["./other.ts", "other.ts"]]);
});
