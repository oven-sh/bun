import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { dirname, join } from "node:path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

// Each tool is built from the file that its package names under "bin", and works on the same small input as under plain Bun.

const files = {
  "input.mjs": `import { readFileSync } from "node:fs";
const unused = 1;
export class Counter {
  #count = 0;
  add(step = 1) {
    this.#count += step;
    return this;
  }
  get count() {
    return this.#count;
  }
}
export function* upTo(limit) {
  for (let index = 0; index < limit; index++) yield index ** 2;
}
export const total = (...numbers) => numbers.reduce((sum, number) => sum + number, 0);
export const text = path => readFileSync(path, "utf8")?.trim() ?? \`nothing at \${path}\`;
`,
};

type Tool = { name: string; bin: string; args: string[] };

const tools: Tool[] = [
  { name: "acorn", bin: "bin/acorn", args: ["--ecma2024", "--module", "--compact", "input.mjs"] },
  { name: "semver", bin: "bin/semver.js", args: ["--range", ">=1.2.3 <2", "1.2.2", "1.5.0", "2.0.0"] },
];

async function run(cwd: string, cmd: string[]) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd);
  return { stdout, stderr, exitCode };
}

test.concurrent.each(tools)(
  "$name",
  async ({ name, bin, args }) => {
    using dir = tempDir(`aot-command-line-tool-${name}`, files);
    const folder = dirname(require.resolve(`${name}/package.json`));
    const entryPoint = join(folder, bin);
    const plain = await run(String(dir), [bunExe(), entryPoint, ...args]);
    expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(plain.stdout).not.toBe("");
    const executable = join(String(dir), "tool" + (isWindows ? ".exe" : ""));
    const built = await run(folder, [bunExe(), "compile", bin, "--outfile", executable]);
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    expect(await run(String(dir), [executable, ...args])).toEqual(plain);
  },
  240_000,
);
