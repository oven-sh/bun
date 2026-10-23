// The programs data-from-outside/annotated-variable-*.ts and read-narrowed-to-never-*.ts under `bun run --aot`, which checks values against their types without compiling.
// data-from-outside-1.test.ts and -2.test.ts run the same programs as executables.
import { expect } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { join } from "path";
import { test } from "./supported";

const folder = join(import.meta.dir, "programs", "data-from-outside");
const programs = readdirSync(folder).filter(name => /^(annotated-variable|read-narrowed-to-never)-.*\.ts$/.test(name));

async function run(...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", ...args],
    cwd: folder,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent.each(programs)("%s", async name => {
  const stored = join(folder, name.replace(/\.ts$/, ".expected.txt"));
  const expected = existsSync(stored) ? readFileSync(stored, "utf8") : (await run(name)).stdout;
  expect(await run("--aot", name)).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
  expect(await run("--debug-aot", name)).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
});
