// The programs data-from-outside/annotated-variable-*.ts and read-narrowed-to-never-*.ts under `bun run --aot`, which checks values against their types without compiling.
// data-from-outside-1.test.ts and -2.test.ts run the same programs as executables.
import { expect } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "fs";
import { bunExe } from "harness";
import { join } from "path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const folder = join(import.meta.dir, "programs", "data-from-outside");
const programs = readdirSync(folder).filter(name => /^(annotated-variable|read-narrowed-to-never)-.*\.ts$/.test(name));

async function run(...args: string[]) {
  const { stdout, stderr, exitCode } = await runCommand([bunExe(), "run", ...args], folder);
  return { stdout, stderr, exitCode };
}

test.concurrent.each(programs)("%s", async name => {
  const stored = join(folder, name.replace(/\.ts$/, ".expected.txt"));
  const expected = existsSync(stored) ? readFileSync(stored, "utf8") : (await run(name)).stdout;
  expect(await run("--aot", name)).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
  expect(await run("--debug-aot", name)).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
});
