import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

// What `bun install` leaves: the package in a store, a link to its folder in node_modules, a link to its bin file in node_modules/.bin.
const files = {
  "node_modules/.store/tool@1.0.0/node_modules/tool/package.json": `{ "name": "tool", "version": "1.2.3", "type": "module", "bin": "bin/tool.mjs" }`,
  "node_modules/.store/tool@1.0.0/node_modules/tool/lib/double.mjs": `export const double = n => n * 2;\n`,
  "node_modules/.store/tool@1.0.0/node_modules/tool/bin/tool.mjs": `#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { double } from "../lib/double.mjs";
const manifest = new URL("../package.json", import.meta.url);
console.log(double(21), relative(import.meta.dirname, fileURLToPath(manifest)), JSON.parse(readFileSync(manifest, "utf8")).version);
`,
};

async function run(cwd: string, cmd: string[]) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd);
  return { stdout, stderr, exitCode };
}

test.skipIf(isWindows).each(["node_modules/.bin/tool", "node_modules/tool/bin/tool.mjs"])(
  "%s finds what lies beside the file that the link names",
  async entryPoint => {
    using dir = tempDir("aot-entry-point-behind-links", files);
    const cwd = String(dir);
    symlinkSync(join(".store", "tool@1.0.0", "node_modules", "tool"), join(cwd, "node_modules", "tool"));
    mkdirSync(join(cwd, "node_modules", ".bin"));
    symlinkSync(join("..", "tool", "bin", "tool.mjs"), join(cwd, "node_modules", ".bin", "tool"));
    const plain = await run(cwd, [bunExe(), "run", `./${entryPoint}`]);
    expect(plain).toEqual({ stdout: `42 ${join("..", "package.json")} 1.2.3\n`, stderr: "", exitCode: 0 });
    const built = await run(cwd, [
      bunExe(),
      "compile",
      `./${entryPoint}`,
      "--asset",
      "./node_modules/.store/tool@1.0.0/node_modules/tool/package.json",
      "--outfile",
      "./built.exe",
    ]);
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    expect(await run(cwd, ["./built.exe"])).toEqual(plain);
  },
  120_000,
);
