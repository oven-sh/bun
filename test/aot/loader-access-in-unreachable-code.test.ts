import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { statSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const wire = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };

async function built(entry: string, files: Record<string, string>) {
  using dir = tempDir("doors-and-reach", files);
  const build = await run(
    [bunExe(), "build", "--compile", "--aot", entry, "--outfile", "program"],
    String(dir),
    bunEnv,
  );
  expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  const ran = await run([join(String(dir), "program")], String(dir), wire);
  return {
    stdout: ran.stdout,
    exitCode: ran.exitCode,
    size: statSync(join(String(dir), isWindows ? "program.exe" : "program")).size,
  };
}

const main = `import { double } from "./lib.mjs";\nconsole.log(double(21));\n`;
const double = `export function double(x) { return x * 2; }\n`;

const notReached: Record<string, string> = {
  "an-export-nobody-imports": `${double}export function evaluate(text) { return (0, eval)(text); }\n`,
  "the-global-object-in-a-function-nobody-calls": `${double}function made(options) { return options; }\nexport function windowOf(options) {\n  const found = options?.window ?? (typeof document !== "undefined" ? window : undefined);\n  return made({ window: found });\n}\n`,
  "a-function-that-only-such-a-function-calls": `${double}function load(name) { return require(name); }\nexport function loadTwice(name) { return [load(name), load(name)]; }\n`,
};

test("a door in a function that nothing reaches brings no built-in module along", async () => {
  const plain = await built("main.mjs", { "main.mjs": main, "lib.mjs": double });
  expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: "42\n", exitCode: 0 });
  for (const [name, lib] of Object.entries(notReached)) {
    const found = await built("main.mjs", { "main.mjs": main, "lib.mjs": lib });
    expect({
      name,
      stdout: found.stdout,
      exitCode: found.exitCode,
      grows: found.size - plain.size > 32 * 1024,
    }).toEqual({ name, stdout: "42\n", exitCode: 0, grows: false });
  }
}, 240_000);

// A load under a computed name brings nothing along: it finds a built-in module that a constant name keeps in the executable.
const name = `const name = ["node:", "zlib"].join("");\nif (process.argv.length > 99) require("node:zlib");\n`;

const reached: Record<string, string> = {
  "at-the-top-of-the-module": `${name}console.log(typeof require(name).gzipSync);\n`,
  "in-a-function-that-is-called": `${name}function load(wanted) { return require(wanted); }\nconsole.log(typeof load(name).gzipSync);\n`,
  "in-a-method-found-by-a-made-key": `${name}const table = { load(wanted) { return require(wanted); } };\nconsole.log(typeof table[["lo", "ad"].join("")](name).gzipSync);\n`,
  "in-a-getter": `${name}class Loader { get found() { return require(name); } }\nconsole.log(typeof new Loader().found.gzipSync);\n`,
  "in-a-static-block": `${name}class Loader { static found; static { Loader.found = require(name); } }\nconsole.log(typeof Loader.found.gzipSync);\n`,
  "in-the-initializer-of-a-field": `${name}class Loader { found = require(name); }\nconsole.log(typeof new Loader().found.gzipSync);\n`,
  "in-the-initializer-of-a-field-of-a-class-with-a-constructor": `${name}function make() {\n  return class Loader { found = require(name); constructor() { this.made = true; } };\n}\nconsole.log(typeof new (make())().found.gzipSync);\n`,
  "in-the-default-of-a-parameter": `${name}function load(found = require(name)) { return found; }\nconsole.log(typeof load().gzipSync);\n`,
  "in-an-arrow-function-in-an-arrow-function": `${name}console.log(typeof [name].map(one => [one].map(wanted => require(wanted))[0])[0].gzipSync);\n`,
  "in-the-computed-name-of-a-method-of-a-class-nobody-names": `${name}class Unnamed { [(console.log(typeof require(name).gzipSync), "m")]() {} }\n`,
  "in-the-computed-name-of-a-static-method": `${name}class Unnamed { static [(console.log(typeof require(name).gzipSync), "m")]() {} }\n`,
  "in-the-computed-name-of-a-getter": `${name}class Unnamed { get [(console.log(typeof require(name).gzipSync), "m")]() { return 1; } }\n`,
  "in-the-computed-name-of-an-async-generator-method": `${name}class Unnamed { async *[(console.log(typeof require(name).gzipSync), "m")]() {} }\n`,
  "in-the-computed-name-of-a-method-of-a-class-in-a-method": `${name}class Outer { make() { class Unnamed { [(console.log(typeof require(name).gzipSync), "m")]() {} } } }\nnew Outer().make();\n`,
  "in-a-generator": `${name}function* all() { yield require(name); }\nconsole.log(typeof all().next().value.gzipSync);\n`,
  "in-an-async-function": `${name}async function load() { await null; return require(name); }\nload().then(found => console.log(typeof found.gzipSync));\n`,
};

for (const [form, text] of Object.entries(reached)) {
  test(`a load under a computed name ${form.replaceAll("-", " ")} finds a built-in module that another line names`, async () => {
    const found = await built("main.cjs", { "main.cjs": text });
    expect({ stdout: found.stdout, exitCode: found.exitCode }).toEqual({ stdout: "function\n", exitCode: 0 });
  }, 120_000);
}
