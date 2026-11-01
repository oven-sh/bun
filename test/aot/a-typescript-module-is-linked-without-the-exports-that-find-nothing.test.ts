import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { afterAll } from "./harness/default-timeout";
import { run } from "./harness/run";
// One by one: a case builds for minutes, and beside others it would pass its limit where Bun has a sanitizer.
import { beforeAll, testOneByOne as test } from "./supported";

// `export { Shape } from "./shapes"` in a TypeScript file may name a type, of which nothing is left in "./shapes" when it runs.
// Where `bun test` isolates its files (--isolate, --parallel) the loader knows which modules are TypeScript, and links such a module
// without the export. Without those flags, and in a JavaScript module, the link fails. A compiled run does the same.
const testFile = (text: string) => `import { test } from "bun:test";\n${text}\ntest("runs", () => {});\n`;
const unchecked = "// @ts-nocheck\n";

const files: Record<string, string> = {
  "package.json": `{}`,
  "src/file.cjs": `exports.one = 1; console.log("file.cjs runs");`,
  "src/computed.cjs": `for (const name of ["late", "other"]) exports[name] = name.length;`,
  "src/replaced.cjs": `module.exports = JSON.parse('{ "parsed": 7 }');`,
  "src/esm.mjs": `export const one = 1; console.log("esm.mjs runs");`,
  "node_modules/untyped/package.json": `{ "name": "untyped", "main": "index.js" }`,
  "node_modules/untyped/index.js": `exports.one = 1;`,

  "src/again.ts": `${unchecked}export { absent as renamed, one } from "./file.cjs"; console.log("again.ts runs");`,
  "a-name-of-a-commonjs-file.test.mjs": testFile(`
    import * as names from "./src/again.ts";
    console.log("a name of a CommonJS file:", Object.keys(names).join(), names.renamed, names.one, "renamed" in names, "one" in names,
      Object.hasOwn(names, "renamed"), JSON.stringify({ ...names }), Reflect.ownKeys(names).length, Object.getOwnPropertyDescriptor(names, "renamed"));`),
  "the-name-beside-it.test.mjs": testFile(`
    import { one } from "./src/again.ts";
    console.log("the name beside it:", one);`),
  "by-require.test.mjs": testFile(`
    import { createRequire } from "node:module";
    const names = createRequire(import.meta.url)("./src/again.ts");
    console.log("by require:", Object.keys(names).join(), names.renamed);`),
  "by-import-call.test.mjs": testFile(`
    const names = await import("./src/again.ts");
    console.log("by import():", Object.keys(names).join(), names.renamed);`),
  "whoever-imports-the-name-fails.test.mjs": testFile(`
    import { renamed } from "./src/again.ts";
    console.log("never printed", renamed);`),

  "src/checked.ts": `export { absent } from "./file.cjs"; console.log("checked.ts runs");`,
  "in-a-file-that-is-checked.test.mjs": testFile(`
    import * as names from "./src/checked.ts";
    console.log("in a file that is checked:", Object.keys(names).join());`),
  "src/component.tsx": `${unchecked}export { absent } from "./file.cjs"; console.log("component.tsx runs");`,
  "src/module.mts": `${unchecked}export { absent } from "./file.cjs"; console.log("module.mts runs");`,
  "every-kind-of-typescript-file.test.mjs": testFile(`
    import * as tsx from "./src/component.tsx";
    import * as mts from "./src/module.mts";
    console.log("every kind of TypeScript file:", Object.keys(tsx).join(), Object.keys(mts).join());`),

  "src/imported.ts": `${unchecked}
    import { absent, one } from "./file.cjs";
    export { absent, one };
    console.log("imported.ts runs", typeof absent, one);`,
  "imported-and-then-exported.test.mjs": testFile(`
    import * as names from "./src/imported.ts";
    console.log("imported and then exported:", Object.keys(names).join());`),

  "src/package.ts": `// @ts-ignore\nexport { Shape, one } from "untyped"; console.log("package.ts runs");`,
  "a-name-of-a-package-without-types.test.mjs": testFile(`
    import * as names from "./src/package.ts";
    console.log("a name of a package without types:", Object.keys(names).join());`),

  "src/only-the-run-knows.ts": `${unchecked}
    export { late, never } from "./computed.cjs";
    export { parsed, unparsed } from "./replaced.cjs";
    console.log("only-the-run-knows.ts runs");`,
  "names-that-only-the-run-knows.test.mjs": testFile(`
    import * as names from "./src/only-the-run-knows.ts";
    console.log("names that only the run knows:", Object.keys(names).join(), names.late, names.never, names.parsed, names.unparsed);`),

  "src/of-a-module.ts": `${unchecked}export { absent as renamed, one } from "./esm.mjs"; console.log("of-a-module.ts runs");`,
  "src/nothing-else-of-a-module.ts": `${unchecked}export { absent } from "./esm.mjs"; console.log("nothing-else-of-a-module.ts runs");`,
  "nothing-else-of-an-es-module.test.mjs": testFile(`
    import * as names from "./src/nothing-else-of-a-module.ts";
    console.log("nothing else of an ES module:", Object.keys(names).join());`),
  "src/of-a-module-imported.ts": `${unchecked}
    import { absent, one } from "./esm.mjs";
    export { absent, one };
    console.log("of-a-module-imported.ts runs", typeof absent, one);`,
  "a-name-of-an-es-module.test.mjs": testFile(`
    import * as names from "./src/of-a-module.ts";
    import * as imported from "./src/of-a-module-imported.ts";
    console.log("a name of an ES module:", Object.keys(names).join(), Object.keys(imported).join());`),

  "src/built-in.ts": `${unchecked}export { Absent, readFileSync } from "node:fs"; console.log("built-in.ts runs");`,
  "a-name-of-a-built-in-module.test.mjs": testFile(`
    import * as names from "./src/built-in.ts";
    console.log("a name of a built-in module:", Object.keys(names).join(), names.Absent);`),

  "src/twice.ts": `${unchecked}export { renamed as twice, one as uno } from "./again.ts"; console.log("twice.ts runs");`,
  "src/star.ts": `export * from "./again.ts"; console.log("star.ts runs");`,
  "through-another-typescript-module.test.mjs": testFile(`
    import * as twice from "./src/twice.ts";
    import * as star from "./src/star.ts";
    console.log("through another TypeScript module:", Object.keys(twice).join(), Object.keys(star).join());`),

  "src/twice.mjs": `export { renamed as twice } from "./again.ts"; console.log("never printed");`,
  "a-javascript-module-that-hands-it-on-fails.test.mjs": testFile(`
    import * as names from "./src/twice.mjs";
    console.log("never printed", Object.keys(names).join());`),
  "src/again.mjs": `export { absent as renamed } from "./file.cjs"; console.log("never printed");`,
  "a-javascript-module-fails.test.mjs": testFile(`
    import * as names from "./src/again.mjs";
    console.log("never printed", Object.keys(names).join());`),
  "src/no-default.mjs": `export const one = 1;`,
  "src/default.ts": `${unchecked}export { default as d } from "./no-default.mjs"; console.log("never printed");`,
  "a-default-that-is-not-there-fails.test.mjs": testFile(`
    import * as names from "./src/default.ts";
    console.log("never printed", Object.keys(names).join());`),
};

type Report = { printed: string; byFile: Record<string, string[]>; exitCode: number | null };

async function runTests(folder: string, flags: string[], words = ""): Promise<Report & { stderr: string }> {
  const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], folder, env);
  const byFile: Record<string, string[]> = {};
  let file = "";
  for (const line of stderr.replaceAll(folder, ".").split("\n")) {
    if (/^\S+\.test\.mjs:$/.test(line)) byFile[(file = line)] = [];
    else if (file && /^(\((pass|fail)\)|\w*Error:)/.test(line)) byFile[file].push(line.replace(/ \[[\d.]+ms\]$/, ""));
  }
  return { printed: stdout.replace(/^bun test .*\n/, ""), byFile, exitCode, stderr };
}

const withoutText = ({ stderr, ...report }: Report & { stderr: string }): Report => report;

let dir: ReturnType<typeof tempDir> | undefined;
let plain: Report;
beforeAll(async () => {
  dir = tempDir("a-typescript-module-is-linked-without-the-exports-that-find-nothing", files);
  plain = withoutText(await runTests(String(dir), ["--isolate"]));
});
afterAll(() => dir?.[Symbol.dispose]());

test("what plain Bun says where the run isolates its files", () => {
  expect(plain.printed).toContain("a name of a CommonJS file: one undefined 1 false true false");
  expect(plain.byFile["whoever-imports-the-name-fails.test.mjs:"]).toEqual([
    expect.stringMatching(/^SyntaxError: Export named 'renamed' not found in module '.*again\.ts'\.$/),
  ]);
});

test.each([
  ["one program", "TestRunLayers:0"],
  ["two layers", "TestRunLayers:2,TestRunPartFiles:1"],
])(
  "a TypeScript module is linked without the exports that find nothing, where the run isolates its files: %s",
  async (_, words) => {
    const compiled = await runTests(String(dir), ["--aot", "--isolate"], words);
    expect(compiled.stderr).not.toContain(`for import "absent"`);
    expect(withoutText(compiled)).toEqual(plain);
  },
);

test("without isolation the link fails", async () => {
  using dir = tempDir("a-typescript-module-without-isolation", files);
  const folder = String(dir);
  const names = [
    "a-name-of-a-commonjs-file",
    "imported-and-then-exported",
    "a-name-of-an-es-module",
    "a-name-of-a-built-in-module",
  ];
  const plain = withoutText(await runTests(folder, names));
  expect(plain.byFile["a-name-of-a-commonjs-file.test.mjs:"]).toEqual([
    "SyntaxError: export 'renamed' not found in './file.cjs'",
  ]);
  expect(withoutText(await runTests(folder, ["--aot", ...names]))).toEqual(plain);
});
