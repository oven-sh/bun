import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

// The functions are laid out as the transpiler prints them: an executable answers with the text of the file, plain Bun with what it printed.
const programs = {
  "without a direct eval": `function f() {
  return 1;
}
console.log(String(f));
console.log(f());
`,
  "with a direct eval": `function f() {
  return 1;
}
function g() {
  return eval("f()") + 1;
}
console.log(String(f));
console.log(String(g));
console.log(g());
`,
};
const endings = {
  "nothing": "",
  "a list of insertions": "// 0+9 (bun --aot: where direct evals were given their scopes)",
  "a word on its encoding": "// bun --aot: this file is not UTF-8: read as the runtime reads it",
};

async function run(cwd: string, cmd: string[]) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd);
  return { stdout, stderr, exitCode };
}

for (const [kind, program] of Object.entries(programs)) {
  for (const [ending, last] of Object.entries(endings)) {
    test(`a file ${kind} that ends with ${ending} answers as under plain Bun`, async () => {
      using dir = tempDir("aot-words-of-the-compiler", { "main.js": program + last });
      const outfile = join(String(dir), "out" + (isWindows ? ".exe" : ""));
      const built = await run(String(dir), [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        "./main.js",
        "--outfile",
        outfile,
      ]);
      expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
        stderr: "",
        exitCode: 0,
      });
      const plain = await run(String(dir), [bunExe(), "run", "./main.js"]);
      expect(plain.stdout).toContain("return 1;");
      expect(await run(String(dir), [outfile])).toEqual(plain);
    }, 120_000);
  }
}
