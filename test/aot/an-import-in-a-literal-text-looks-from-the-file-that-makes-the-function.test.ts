import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// `new Function('return import("dep")')()` keeps an import from being rewritten by a compiler, and it runs from the file that makes the function.
// The text is a module of its own whose path is no folder of the project, so the import found nothing, and an executable said "it isn't in this executable".
const say = (name: string, specifier: string) =>
  `console.log(${JSON.stringify(name)}, Object.keys(await new Function('return import("${specifier}")')()).sort().join());`;

const inEveryForm = [
  say("an ES package:", "es-package"),
  say("a CommonJS package:", "commonjs-package"),
  say("a module of Bun's own:", "node:path"),
  `try { new Function('import("a", "b", "c")'); } catch (error) { console.log("three arguments:", error.name); }`,
  `try { new Function('return require("./src/three.cjs")')(); } catch (error) { console.log("require:", error.name); }`,
];
// `bun run` looks from the code that calls the function, which may be in another folder than the code that made it. An executable leaves a path in a text to the run time, which refuses it.
const inTestFiles = [
  say("an ES file:", "./src/two.mjs"),
  say("a CommonJS file:", "./src/three.cjs"),
  `try { await new Function('return import("absent-package")')(); } catch (error) { console.log("absent:", error.name); }`,
];

const files: Record<string, string> = {
  "package.json": `{ "name": "project", "type": "module" }`,
  "node_modules/es-package/package.json": `{ "name": "es-package", "type": "module", "main": "index.js" }`,
  "node_modules/es-package/index.js": `export const one = 1;`,
  "node_modules/commonjs-package/package.json": `{ "name": "commonjs-package", "main": "index.js" }`,
  "node_modules/commonjs-package/index.js": `exports.one = 1;`,
  "src/two.mjs": `export const two = 2;`,
  "src/three.cjs": `exports.three = 3;`,
  "main.mjs": inEveryForm.join("\n"),
  "main.test.mjs": `import { test } from "bun:test";\n${[...inEveryForm, ...inTestFiles].join("\n")}\ntest("end", () => {});`,
};

const expected = [
  "an ES package: one",
  "a CommonJS package: default,one",
  expect.stringContaining("a module of Bun's own: "),
  "three arguments: SyntaxError",
  "require: ReferenceError",
];

const printed = (stdout: string) => stdout.split("\n").filter(line => line && !line.startsWith("bun test "));

test("as an executable, it finds what bun run finds", async () => {
  using dir = tempDir("aot-an-import-in-a-literal-text", files);
  const directory = String(dir);
  const plain = await run([bunExe(), "main.mjs"], directory, bunEnv);
  expect(printed(plain.stdout)).toEqual(expected);
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", join(directory, "program")],
    directory,
    bunEnv,
  );
  expect(built.exitCode).toBe(0);
  const compiled = await run([join(directory, "program")], directory, bunEnv);
  expect(printed(compiled.stdout)).toEqual(printed(plain.stdout));
}, 180_000);

for (const [way, words] of [
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
]) {
  test(`in a test file, it finds what plain bun test finds, ${way}`, async () => {
    using dir = tempDir("aot-an-import-in-a-literal-text", files);
    const directory = String(dir);
    const plain = await run([bunExe(), "test", "--isolate", "./main.test.mjs"], directory, bunEnv);
    expect(printed(plain.stdout).slice(0, 5)).toEqual(expected);
    expect(printed(plain.stdout).slice(5)).toEqual([
      "an ES file: two",
      "a CommonJS file: default,three",
      "absent: ResolveMessage",
    ]);
    const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
    const compiled = await run([bunExe(), "test", "--aot", "--isolate", "./main.test.mjs"], directory, env);
    expect(printed(compiled.stdout)).toEqual(printed(plain.stdout));
  }, 180_000);
}
