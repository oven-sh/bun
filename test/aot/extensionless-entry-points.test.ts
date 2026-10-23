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
