import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A CommonJS file whose body throws goes out of require.cache. The loader of ES modules stays as it is, and a require() that finds nothing in the cache looks there before it reads the file.
// So only a file that nothing but require() has loaded runs again. A file that an import ran keeps its error, and a file that was imported while it ran answers with its namespace object.
// A test run took every such file out of the program and ran it again from disk.
const thrower = (name: string, middle = "") => `runs.${name} = (runs.${name} ?? 0) + 1;
say("${name}: the file runs", runs.${name});
exports.value = runs.${name};
${middle}
throw new Error("${name} throws " + runs.${name});
`;
const importer = (name: string) => `import * as names from "./file.cjs";
say("${name}: the module runs", JSON.stringify(Object.keys(names)));
`;
const asked = (name: string, first: string) => `
try {
  ${first};
  say("${name}: loaded");
} catch (error) {
  say("${name}: threw", error.message);
}
for (const round of [1, 2]) {
  try {
    say("${name}: required", round, show(require("./${name}/file.cjs")));
  } catch (error) {
    say("${name}: require threw", round, error.message);
  }
}
say("${name}: in require.cache", require.resolve("./${name}/file.cjs") in require.cache);
`;

const files: Record<string, string> = {
  "package.json": `{}`,
  "required/file.cjs": thrower("required"),
  "imported/file.cjs": thrower("imported"),
  "imported/module.mjs": importer("imported"),
  "awaited/file.cjs": thrower("awaited"),
  "below/file.cjs": thrower("below"),
  "below/module.mjs": importer("below"),
  "upward/file.cjs": thrower(
    "upward",
    `import("./module.mjs").then(() => say("upward: module.mjs loaded"), error => say("upward: module.mjs rejected", error.message));`,
  ),
  "upward/module.mjs": importer("upward"),
  "back/file.cjs": thrower("back", `require("./module.mjs");`),
  "back/module.mjs": importer("back"),
  "a.test.mjs": `import { test } from "bun:test";
globalThis.runs = {};
globalThis.say = (...words) => console.log(...words);
const show = value => JSON.stringify(value) + " " + Object.prototype.toString.call(value);
${asked("required", `require("./required/file.cjs")`)}
${asked("imported", `require("./imported/module.mjs")`)}
${asked("awaited", `await import("./awaited/file.cjs")`)}
${asked("below", `await import("./below/module.mjs")`)}
${asked("upward", `require("./upward/module.mjs")`)}
${asked("back", `require("./back/file.cjs")`)}
test("end", () => {});
`,
};

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  return { stdout: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")), exitCode };
}

for (const [way, words] of [
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
]) {
  test(`require() runs a CommonJS file that threw again only where no import has loaded the file, ${way}`, async () => {
    using dir = tempDir("aot-a-file-that-throws-under-an-import", files);
    const plain = await runTests(String(dir), undefined);
    expect(plain).toEqual({
      stdout: [
        "required: the file runs 1",
        "required: threw required throws 1",
        "required: the file runs 2",
        "required: require threw 1 required throws 2",
        "required: the file runs 3",
        "required: require threw 2 required throws 3",
        "required: in require.cache false",
        "imported: the file runs 1",
        "imported: threw imported throws 1",
        "imported: require threw 1 imported throws 1",
        "imported: require threw 2 imported throws 1",
        "imported: in require.cache false",
        "awaited: the file runs 1",
        "awaited: threw awaited throws 1",
        "awaited: require threw 1 awaited throws 1",
        "awaited: require threw 2 awaited throws 1",
        "awaited: in require.cache false",
        "below: the file runs 1",
        "below: threw below throws 1",
        "below: require threw 1 below throws 1",
        "below: require threw 2 below throws 1",
        "below: in require.cache false",
        "upward: the file runs 1",
        "upward: the module runs []",
        "upward: loaded",
        "upward: required 1 {} [object Module]",
        "upward: required 2 {} [object Module]",
        "upward: in require.cache true",
        "back: the file runs 1",
        `back: the module runs ["default","value"]`,
        "back: threw back throws 1",
        `back: required 1 {"default":{"value":1},"value":1} [object Module]`,
        `back: required 2 {"default":{"value":1},"value":1} [object Module]`,
        "back: in require.cache true",
        "upward: module.mjs loaded",
      ],
      exitCode: 0,
    });
    expect(await runTests(String(dir), words, "--aot")).toEqual(plain);
  }, 180_000);
}
