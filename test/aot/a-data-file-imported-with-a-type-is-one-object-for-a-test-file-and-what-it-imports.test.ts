import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `import data from "./data.json" with { type: "json" }` in a test file and in a file that it imports: one module, so one object, and what one of them stores the other reads.
// A plugin that a test file registers may answer for any file of data, so the statements of the test files are left to the loader, which has to be given the compiled module.
const testFile = (text: string) => `import { test } from "bun:test";\n${text}\ntest("runs", () => {});\n`;
const files = {
  "package.json": `{}`,
  "plain.json": `{"a": 1}\n`,
  "typed.json": `{"a": 1}\n`,
  "depth.json": `{"a": 1}\n`,
  "below.mjs": `
    import plain from "./plain.json";
    import typed from "./typed.json" with { type: "json" };
    import depth from "./depth.json" with { type: "text" };
    export { plain, typed, depth };
    export const readTyped = () => typed.a;`,
  "a.test.ts": testFile(`
    Bun.plugin({
      name: "probe",
      setup(build) {
        build.onLoad({ filter: /\\.yaml$/ }, () => ({ exports: { value: "from plugin" }, loader: "object" }));
      },
    });`),
  "c.test.mjs": testFile(`
    import * as below from "./below.mjs";
    import plain from "./plain.json";
    import typed from "./typed.json" with { type: "json" };
    import depth from "./depth.json" with { type: "yaml" };
    console.log("no type:", below.plain === plain, "json:", below.typed === typed);
    console.log("yaml nearer than text:", below.depth === depth, typeof below.depth, typeof depth);
    typed.a = 2;
    console.log("stored by the test file, read by the other:", below.readTyped());`),
};
const printed = [
  "no type: true json: true",
  "yaml nearer than text: true object object",
  "stored by the test file, read by the other: 2",
];

async function runTests(folder: string, flags: string[], words = "") {
  const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, exitCode } = await run([bunExe(), "test", ...flags], folder, env);
  return { printed: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")), exitCode };
}

for (const [form, flags, words] of [
  ["at default flags", [], ""],
  ["as one program under --isolate", ["--isolate"], "TestRunLayers:0"],
] as const)
  test.concurrent(
    `beside a plugin, ${form}`,
    async () => {
      using dir = tempDir("one-object-of-a-typed-data-file", files);
      expect(await runTests(String(dir), [...flags])).toEqual({ printed, exitCode: 0 });
      expect(await runTests(String(dir), ["--aot", ...flags], words)).toEqual({ printed, exitCode: 0 });
    },
    240_000,
  );

// Over layers the test file is a program of its own, and below.mjs lies in the program below it. No plugin is needed for that. typed.json: the program below holds it under its
// type. depth.json: which of its two types comes first shows when the test file runs, so neither program holds it: the loader does, as under `bun test`.
test.concurrent(
  "over two layers, without a plugin",
  async () => {
    const { "a.test.ts": _, ...withoutPlugin } = files;
    using dir = tempDir("one-object-of-a-typed-data-file-layers", withoutPlugin);
    expect(await runTests(String(dir), ["--isolate"])).toEqual({ printed, exitCode: 0 });
    const words = "TestRunLayers:2,TestRunPartFiles:1";
    expect(await runTests(String(dir), ["--aot", "--isolate"], words)).toEqual({ printed, exitCode: 0 });
  },
  240_000,
);

// Each test file has a realm of its own under --isolate, so each decides anew what below.mjs gets: the build cannot bind the statement of below.mjs to one form of the file.
const twoTypes = {
  "package.json": `{}`,
  "depth.json": `a = 1\n`,
  "below.mjs": `import held from "./depth.json" with { type: "text" };\nexport { held };\n`,
  "a.test.mjs": testFile(`
    import near from "./depth.json" with { type: "yaml" };
    import { held } from "./below.mjs";
    console.log("yaml first:", typeof near, typeof held, held === near);`),
  "b.test.mjs": testFile(`
    import near from "./depth.json" with { type: "toml" };
    import { held } from "./below.mjs";
    console.log("toml first:", typeof near, typeof held, held === near);`),
  "c.test.mjs": testFile(`
    import { held } from "./below.mjs";
    console.log("text alone:", typeof held);`),
};
// TODO: as one program the statement of below.mjs is bound to one form for all the test files: "toml first: string string true".
for (const [form, words] of [["over two layers", "TestRunLayers:2,TestRunPartFiles:1"]] as const)
  test.concurrent(
    `two test files ask for two types of one file, ${form}`,
    async () => {
      using dir = tempDir("two-test-files-two-types", twoTypes);
      const expected = {
        printed: ["yaml first: string string true", "toml first: object object true", "text alone: string"],
        exitCode: 0,
      };
      expect(await runTests(String(dir), ["--isolate"])).toEqual(expected);
      expect(await runTests(String(dir), ["--aot", "--isolate"], words)).toEqual(expected);
    },
    240_000,
  );

// `export { default as near } from "./depth.toml" with { type: "yaml" }` hands the loader its type as an import statement does, so it too decides what a file loaded later gets,
// however the run is cut into layers. Plain drops the type of an export statement: what is expected is what it prints for `import near from ".."; export { near }`.
// below.mjs is loaded by a call: of two files that load side by side, plain lets the one that is read first decide.
const passedOn = (statements: string) => ({
  "package.json": `{}`,
  "depth.toml": `a = 1\n`,
  "other.toml": `a = 1\n`,
  "star.toml": `a = 1\n`,
  "below.mjs": `
    import held from "./depth.toml" with { type: "text" };
    import parsed from "./other.toml" with { type: "toml" };
    import * as star from "./star.toml" with { type: "text" };
    export { held, parsed, star };`,
  "passes-on.mjs": statements,
  "a.test.mjs": testFile(`
    import { near, text, all } from "./passes-on.mjs";
    const { held, parsed, star } = await import("./below.mjs");
    console.log("yaml before text:", JSON.stringify(near), held === near);
    console.log("text before toml:", JSON.stringify(text), parsed === text);
    console.log("toml before text:", JSON.stringify(all.default), all === star);`),
});
const imported = passedOn(`
  import near from "./depth.toml" with { type: "yaml" };
  import text from "./other.toml" with { type: "text" };
  import * as all from "./star.toml" with { type: "toml" };
  export { near, text, all };`);
const exported = passedOn(`
  export { default as near } from "./depth.toml" with { type: "yaml" };
  export { default as text } from "./other.toml" with { type: "text" };
  export * as all from "./star.toml" with { type: "toml" };`);
for (const [form, words] of [
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
] as const)
  test.concurrent(
    `an export statement asks for a type, ${form}`,
    async () => {
      using withImports = tempDir("typed-import-passed-on", imported);
      using withExports = tempDir("typed-export-from", exported);
      const expected = {
        printed: [
          'yaml before text: "a = 1" true',
          'text before toml: "a = 1\\n" true',
          'toml before text: {"a":1} true',
        ],
        exitCode: 0,
      };
      expect(await runTests(String(withImports), ["--isolate"])).toEqual(expected);
      expect(await runTests(String(withExports), ["--aot", "--isolate"], words)).toEqual(expected);
    },
    240_000,
  );
