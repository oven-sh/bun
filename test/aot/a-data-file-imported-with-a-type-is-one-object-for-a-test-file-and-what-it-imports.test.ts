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

// Over layers the test file is a program of its own, and below.mjs lies in the program below it, which holds typed.json under its type. No plugin is needed for that.
// Which of two types of one file comes first is decided at the build of each program there, so depth.json is left out.
test.concurrent(
  "over two layers, without a plugin",
  async () => {
    const { "a.test.ts": _, "depth.json": __, ...rest } = files;
    const withoutDepth = (text: string) =>
      text
        .split("\n")
        .filter(line => !line.includes("depth"))
        .join("\n");
    using dir = tempDir("one-object-of-a-typed-data-file-layers", {
      ...rest,
      "below.mjs": withoutDepth(files["below.mjs"]) + "\nexport { plain, typed };",
      "c.test.mjs": withoutDepth(files["c.test.mjs"]),
    });
    const expected = { printed: [printed[0], printed[2]], exitCode: 0 };
    expect(await runTests(String(dir), ["--isolate"])).toEqual(expected);
    expect(await runTests(String(dir), ["--aot", "--isolate"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(expected);
  },
  240_000,
);
