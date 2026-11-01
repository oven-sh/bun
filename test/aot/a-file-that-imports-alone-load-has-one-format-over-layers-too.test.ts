// `bun test` has two loaders. The one behind `require` takes a file named .cjs for CommonJS. The one behind `import` asks only for the "type" of the package, so a .cjs file
// whose text does not say what it is (a script that only has side effects) is an ES module where imports alone load it: strict, and evaluated in the order of the modules,
// behind the CommonJS files beside it. A run that is built in layers does not see, while it builds a layer, the files above that load the layer's entry points. It took
// each such entry point for required: sloppy, and evaluated in another order.
import { expect } from "bun:test";
import { foldersOfOneRun } from "./harness/folders-of-one-run";
import { test } from "./supported";

const says = (name: string) => `
  function mode() { return (function () { return this === undefined ? "strict" : "sloppy"; })(); }
  console.error("OUT ${name}", mode(), (() => { try { globalThis.undefined = 1; return "no throw"; } catch (e) { return e.constructor.name; } })());`;
const files = {
  "bare.cjs": says("bare.cjs"),
  "uses.cjs": says("uses.cjs") + "\nexports.used = true;",
  "node_modules/pkg/package.json": `{ "name": "pkg" }`,
  "node_modules/pkg/side.cjs": says("pkg/side.cjs"),
  "node_modules/pkg/index.cjs": says("pkg/index.cjs") + "\nexports.used = true;",
  "project.ts": `import "pkg/side.cjs";\nimport "pkg/index.cjs";\nexport const project = 1;`,
};
const testFiles = {
  "a statement": `import { test } from "bun:test";\nimport "./bare.cjs";\nimport "./uses.cjs";\ntest("t", () => {});`,
  "import()": `import { test } from "bun:test";\ntest("t", async () => { await import("./bare.cjs"); await import("./uses.cjs"); });`,
  "require": `const { test } = require("bun:test");\ntest("t", () => { require("./bare.cjs"); require("./uses.cjs"); });`,
  "a file of the project imports a package": `import { test } from "bun:test";\nimport "./project.ts";\ntest("t", () => {});`,
};

// About the layers: every case runs in both forms. What loads a file is asked of that file alone, and each case has its own, so they share the run of a form.
const linesOf = foldersOfOneRun(
  "aot-one-format-over-layers",
  Object.fromEntries(
    Object.entries(testFiles).map(([name, testFile]) => [
      name,
      { ...files, [name === "require" ? "a.test.cjs" : "a.test.ts"]: testFile },
    ]),
  ),
);

test.concurrent.each(Object.keys(testFiles))("loaded by %s: plain Bun", async name => {
  expect((await linesOf(name, [])).lines.length).toBe(2);
});

test.concurrent.each(
  Object.keys(testFiles).flatMap(name =>
    (
      [
        ["as the run builds itself", undefined],
        ["two layers", "TestRunLayers:2"],
      ] as const
    ).map(([form, words]) => [name, form, words] as const),
  ),
)("loaded by %s: %s", async (name, _, words) => {
  expect(await linesOf(name, ["--aot"], words)).toEqual(await linesOf(name, []));
});
