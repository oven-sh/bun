import { expect } from "bun:test";
import type { DirectoryTree } from "harness";
import { test } from "../supported";
import { describeTree, type DescribeOptions, type TreeGraph } from "./describe";

type Extension = "js" | "ts";
type Form = [name: string, text: string, options?: DescribeOptions];
type FormCase = [name: string, extension: Extension, text: string, options: DescribeOptions];

const featureImport = 'import { feature } from "bun:bundle";';

const requireResolveForm: Form = [
  "require.resolve",
  'if (false) require.resolve("./dead"); require.resolve("./live");',
];

const unboundDefineForms: Form[] = [
  ["define for a global", 'if (DEBUG) require("./dead"); else require("./live");', { defines: { DEBUG: false } }],
  [
    "define for a member path",
    'if (process.env.MODE !== "production") require("./dead"); else require("./live");',
    { defines: { "process.env.MODE": "production" } },
  ],
  [
    "define for import.meta",
    'if (import.meta.env.SERVER) require("./live"); else require("./dead");',
    { defines: { "import.meta.env.SERVER": true } },
  ],
];

const forms: Form[] = [
  ["if statement", 'if (false) require("./dead"); else require("./live");'],
  ["logical AND", 'false && require("./dead"); true && require("./live");'],
  ["nullish coalescing", 'null ?? require("./live"); 0 ?? require("./dead");'],
  ["conditional expression", 'const m = true ? require("./live") : require("./dead");'],
  ["constant variable", 'const DEBUG = false;\nif (DEBUG) require("./dead"); else require("./live");'],
  ["typeof comparison", 'if (typeof 1 === "string") require("./dead"); else require("./live");'],
  ["import.meta.main", 'if (import.meta.main) require("./live"); else require("./dead");'],
  [
    "disabled feature in an if statement",
    `${featureImport}\nif (feature("OFF")) require("./dead"); else require("./live");`,
  ],
  [
    "disabled feature in a conditional expression",
    `${featureImport}\nconst m = feature("OFF") ? require("./dead") : require("./live");`,
  ],
  ["function declaration in dead code", 'if (false) { function later() { require("./dead"); } } require("./live");'],
  requireResolveForm,
  [
    "enabled feature",
    `${featureImport}\nif (feature("ON")) require("./live"); else require("./dead");`,
    { features: ["ON"] },
  ],
  ...unboundDefineForms,
  [
    "variable named like a define",
    'const DEBUG = true;\nif (DEBUG) require("./live"); else require("./dead");',
    { defines: { DEBUG: false } },
  ],
];

const importForms = forms
  .filter(form => form !== requireResolveForm)
  .map(([name, text, options]): Form => [name, text.replaceAll("require(", "import("), options]);

// Every case has four elements: bun:test passes a `done` callback to a test function with more parameters than its row.
function casesOf(table: Form[], extensions: Extension[]): FormCase[] {
  return table.flatMap(([name, text, options = {}]) =>
    extensions.map((extension): FormCase => [name, extension, text, options]),
  );
}

function formFiles(extension: Extension, text: string): DirectoryTree {
  return { [`main.${extension}`]: text, [`live.${extension}`]: "export {};", [`dead.${extension}`]: "export {};" };
}

function expectLiveArmOnly(graph: TreeGraph, extension: Extension, kind: "import" | "require") {
  const sites = graph.file(`main.${extension}`).sites.filter(site => site.specifier !== "bun:bundle");
  expect(sites).toEqual([{ specifier: "./live", kind, answer: `live.${extension}`, externalKind: null }]);
  expect(graph.compiledFiles).toEqual([`live.${extension}`, `main.${extension}`]);
}

test.each(casesOf(forms, ["js", "ts"]))("%s in main.%s", (_, extension, text, options) => {
  using graph = describeTree(formFiles(extension, text), [`main.${extension}`], options);

  expect(graph.has(`dead.${extension}`)).toBe(false);
  expectLiveArmOnly(graph, extension, "require");
});

test.each(casesOf(importForms, ["js"]))("%s with import() in main.%s", (_, extension, text, options) => {
  using graph = describeTree(formFiles(extension, text), [`main.${extension}`], options);

  expect(graph.has(`dead.${extension}`)).toBe(false);
  expectLiveArmOnly(graph, extension, "import");
});

test.each(casesOf(importForms, ["ts"]))("%s with import() in main.%s", (_, extension, text, options) => {
  using graph = describeTree(formFiles(extension, text), [`main.${extension}`], options);

  // tsc follows import() in dead code too, so dead.ts can still be in the program through a type edge.
  expectLiveArmOnly(graph, extension, "import");
});

test.each(unboundDefineForms)("without the define both arms are followed: %s", (_, text) => {
  using graph = describeTree(formFiles("js", text), ["main.js"]);

  expect(
    graph
      .file("main.js")
      .sites.map(site => site.answer)
      .toSorted(),
  ).toEqual(["dead.js", "live.js"]);
  expect(graph.compiledFiles.toSorted()).toEqual(["dead.js", "live.js", "main.js"]);
});

test("a folded import is not resolved", () => {
  using graph = describeTree(
    { "main.js": 'if (false) require("./no-such-file"); if (false) require("no-such-package");' },
    ["main.js"],
  );

  expect(graph.file("main.js").sites).toEqual([]);
});

test("a live import of a missing file is a site", () => {
  using graph = describeTree({ "main.js": 'try { require("./no-such-file"); } catch {}' }, ["main.js"]);

  expect(graph.file("main.js").sites).toEqual([
    { specifier: "./no-such-file", kind: "require", answer: "not found (ModuleNotFound)", externalKind: null },
  ]);
});

function importingText(extension: Extension, typeUse: string): string {
  return [
    `import { a } from "./unused.${extension}";`,
    `import { B } from "./type-use.${extension}";`,
    `import { c } from "./dead-use.${extension}";`,
    `import { d } from "./used.${extension}";`,
    `import "./bare.${extension}";`,
    typeUse,
    "if (false) c();",
    "d();",
  ].join("\n");
}

function importedFiles(extension: Extension): DirectoryTree {
  return {
    [`unused.${extension}`]: "export function a() {}",
    [`type-use.${extension}`]: "export class B {}",
    [`dead-use.${extension}`]: "export function c() {}",
    [`used.${extension}`]: "export function d() {}",
    [`bare.${extension}`]: "export {};",
  };
}

test("unused imports of TypeScript", () => {
  using graph = describeTree({ "main.ts": importingText("ts", "let b: B;"), ...importedFiles("ts") }, ["main.ts"]);

  // bun run drops an import statement only if none of its names is used as a value anywhere, dead code included.
  expect(graph.file("main.ts").sites.map(site => site.specifier)).toEqual(["./dead-use.ts", "./used.ts", "./bare.ts"]);
  expect(graph.compiledFiles).toEqual(["dead-use.ts", "used.ts", "bare.ts", "main.ts"]);
  expect(graph.file("main.ts").typeEdges).toEqual(["unused.ts", "type-use.ts", "dead-use.ts", "used.ts", "bare.ts"]);
  expect(graph.file("unused.ts")).toMatchObject({ role: "Checked", isCompiled: false });
  expect(graph.file("type-use.ts")).toMatchObject({ role: "Checked", isCompiled: false });
});

test("unused imports of JavaScript", () => {
  using graph = describeTree({ "main.js": importingText("js", ""), ...importedFiles("js") }, ["main.js"]);

  expect(graph.file("main.js").sites.map(site => site.specifier)).toEqual([
    "./unused.js",
    "./type-use.js",
    "./dead-use.js",
    "./used.js",
    "./bare.js",
  ]);
  expect(graph.compiledFiles).toEqual(["unused.js", "type-use.js", "dead-use.js", "used.js", "bare.js", "main.js"]);
});
