import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// The loader keeps one module for a path and a kind of `type`: none, "json", and every other type together. Whichever import comes first in a kind decides what the later ones get.
// A plugin that a test file registers may answer for any file of data, so the statements of the test files are left to the loader. A call of import() behind such a statement has to
// ask the loader too, whatever form of the file the build has bound the call to.
const testFile = (text: string) => `import { test } from "bun:test";\n${text}\ntest("runs", () => {});\n`;
const files = {
  "package.json": `{}`,
  "one.txt": `a = 1\n`,
  "two.txt": `a = 1\n`,
  "three.json": `{"a": 1}\n`,
  "a.test.ts": testFile(`
    Bun.plugin({
      name: "probe",
      setup(build) {
        build.onLoad({ filter: /\\.yaml$/ }, () => ({ exports: { value: "from plugin" }, loader: "object" }));
      },
    });`),
  "c.test.mjs": testFile(`
    import * as asText from "./one.txt" with { type: "text" };
    import * as jsonAsText from "./three.json" with { type: "text" };
    const show = (label, first, second) =>
      console.log(label + ":", JSON.stringify(first.default), JSON.stringify(second.default), first === second);
    show("statement of text, call of toml", asText, await import("./one.txt", { with: { type: "toml" } }));
    const type = ["to", "ml"].join("");
    show("statement of text, a type known at run time", asText, await import("./one.txt", { with: { type } }));
    show(
      "call of text, call of toml",
      await import("./two.txt", { with: { type: "text" } }),
      await import("./two.txt", { with: { type: "toml" } }),
    );
    show("statement of text, call of yaml", jsonAsText, await import("./three.json", { with: { type: "yaml" } }));
    show("statement of text, call of json", jsonAsText, await import("./three.json", { with: { type: "json" } }));
    show("statement of text, call without a type", jsonAsText, await import("./three.json"));`),
};
const printed = [
  String.raw`statement of text, call of toml: "a = 1\n" "a = 1\n" true`,
  String.raw`statement of text, a type known at run time: "a = 1\n" "a = 1\n" true`,
  String.raw`call of text, call of toml: "a = 1\n" "a = 1\n" true`,
  String.raw`statement of text, call of yaml: "{\"a\": 1}\n" "{\"a\": 1}\n" true`,
  String.raw`statement of text, call of json: "{\"a\": 1}\n" {"a":1} false`,
  String.raw`statement of text, call without a type: "{\"a\": 1}\n" {"a":1} false`,
];

async function runTests(folder: string, flags: string[], words = "") {
  const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, exitCode } = await run([bunExe(), "test", ...flags], folder, env);
  return { printed: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")), exitCode };
}

for (const [form, flags, words] of [
  ["at default flags", [], ""],
  ["as one program under --isolate", ["--isolate"], "TestRunLayers:0"],
  ["over two layers", ["--isolate"], "TestRunLayers:2,TestRunPartFiles:1"],
] as const)
  test.concurrent(
    form,
    async () => {
      using dir = tempDir("a-call-behind-a-statement-beside-a-plugin", files);
      expect(await runTests(String(dir), [...flags])).toEqual({ printed, exitCode: 0 });
      expect(await runTests(String(dir), ["--aot", ...flags], words)).toEqual({ printed, exitCode: 0 });
    },
    240_000,
  );
