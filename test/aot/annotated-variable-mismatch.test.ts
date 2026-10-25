// The programs data-from-outside/annotated-variable-*.ts and read-narrowed-to-never-*.ts under `bun run --aot`, which checks values against their types without compiling.
// data-from-outside-1.test.ts and -2.test.ts run the same programs as executables.
import { expect } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { bunExe } from "harness";
import { basename, dirname } from "path";
import { run as runCommand } from "./harness/run";
import { find, keptBeside, taken } from "./run-programs";
import { test } from "./supported";

const isAsked = (path: string) => /^(annotated-variable|read-narrowed-to-never)-.*\.ts$/.test(basename(path));
const paths = taken(find("data-from-outside").filter(isAsked), () => true);

async function run(...args: string[]) {
  const { stdout, stderr, exitCode } = await runCommand([bunExe(), "run", ...args], dirname(args.at(-1)!));
  return { stdout, stderr, exitCode };
}

test("the folder holds such programs", () => expect(paths.length).toBeGreaterThan(20));

test.concurrent.each(paths.map(path => [basename(path), path]))("%s", async (_, path) => {
  const stored = keptBeside(path) + ".expected.txt";
  const expected = existsSync(stored) ? readFileSync(stored, "utf8") : (await run(path)).stdout;
  expect(await run("--aot", path)).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
  expect(await run("--debug-aot", path)).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
});
