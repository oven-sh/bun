import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const files = {
  "lib.js": `exports.double = n => n * 2;\n`,
  "tool": `#!/usr/bin/env node\n"use strict";\nconst { double } = require("./lib.js");\nconsole.log("tool", double(21), process.argv.slice(2).join());\n`,
  "bin/nested": `#!/usr/bin/env node\nconst path = require("node:path");\nconst { double } = require("../lib.js");\nconsole.log(path.join("a", "b"), double(4), typeof module, typeof exports);\n`,
  "with.dots.in-its-name": `import { double } from "./lib.js";\nconsole.log("a module", double(5), typeof import.meta.url);\n`,
};
const entries = ["tool", "bin/nested", "with.dots.in-its-name"];

async function run(cwd: string, cmd: string[]) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd);
  return { stdout, stderr, exitCode };
}

test.concurrent.each(entries)(
  "%s answers under --aot as under plain Bun",
  async entry => {
    using dir = tempDir("aot-entry-points-without-an-extension", files);
    const plain = await run(String(dir), [bunExe(), "run", `./${entry}`, "one", "two"]);
    expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(plain.stdout).not.toBe("");
    expect(await run(String(dir), [bunExe(), "run", "--debug-aot", `./${entry}`, "one", "two"])).toEqual(plain);
    const built = await run(String(dir), [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      `./${entry}`,
      "--outfile",
      `./built.exe`,
    ]);
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    expect(await run(String(dir), [`./built.exe`, "one", "two"])).toEqual(plain);
  },
  120_000,
);

async function build(cwd: string, entry: string) {
  return run(cwd, [bunExe(), "build", "--compile", "--aot", entry, "--outfile", "./built.exe"]);
}

test("text that is JavaScript too is not held to TypeScript's rules", async () => {
  using dir = tempDir("aot-entry-point-without-an-extension-in-plain-javascript", {
    "tool": `#!/usr/bin/env node
function join(value, long, short, text) {
  return [value, long, short, text].join();
}
const options = {};
options.output = join(1, "second", "s");
var name = options.output;
var name = name.length;
console.log(options.output, name, Math.log10(\`1\${"00"}\`));
`,
  });
  const plain = await run(String(dir), [bunExe(), "run", "./tool"]);
  expect(plain).toEqual({ stdout: "1,second,s, 11 2\n", stderr: "", exitCode: 0 });
  expect(await build(String(dir), "./tool")).toMatchObject({
    stderr: expect.not.stringContaining("warn"),
    exitCode: 0,
  });
  expect(await run(String(dir), ["./built.exe"])).toEqual(plain);
}, 120_000);

test("text with TypeScript's syntax is held to TypeScript's rules", async () => {
  using dir = tempDir("aot-entry-point-without-an-extension-in-typescript", {
    "right": `#!/usr/bin/env bun\nconst count: number = 41;\nconsole.log(count + 1);\n`,
    "wrong": `#!/usr/bin/env bun\nconst count: number = "41";\nconsole.log(count + 1);\n`,
  });
  expect(await build(String(dir), "./right")).toMatchObject({ exitCode: 0 });
  expect(await run(String(dir), ["./built.exe"])).toEqual({ stdout: "42\n", stderr: "", exitCode: 0 });
  const refused = await build(String(dir), "./wrong");
  expect(refused.exitCode).toBe(1);
  expect(refused.stderr).toContain("TS2322");
}, 120_000);

test("an import that text without an extension never uses is dropped, as under plain Bun", async () => {
  using dir = tempDir("aot-entry-point-without-an-extension-unused-import", {
    "loud.js": `console.log("loud runs");\nexport const unused = 1;\n`,
    "tool": `import { unused } from "./loud.js";\nconsole.log("tool runs");\n`,
  });
  const plain = await run(String(dir), [bunExe(), "run", "./tool"]);
  expect(plain.exitCode).toBe(0);
  expect(await build(String(dir), "./tool")).toMatchObject({ exitCode: 0 });
  expect(await run(String(dir), ["./built.exe"])).toEqual(plain);
}, 120_000);
