// bench/compiler/run.ts takes `--scenarios=<name>,<name>`. Seven of its names held a comma themselves ("typed, one thread"), so none of them could be chosen, and a name that it
// does not have was passed over in silence: `--scenarios="typed, one thread"` ran "typed", on every thread, and printed its numbers.
import { expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";
import { run } from "../harness/run";
import { test } from "../supported";

const script = join(import.meta.dir, "..", "..", "..", "bench", "compiler", "run.ts");
const benchmark = (...words: string[]) => run([bunExe(), script, ...words], import.meta.dir, bunEnv);

test("a name that the benchmark does not have ends the run, and the names are listed", async () => {
  const { stdout, stderr, exitCode } = await benchmark("--scenarios=typed, one thread", "--sizes=300", "--runs=1");
  expect(stderr).toStartWith(`--scenarios: there is no " one thread". The scenarios:\n`);
  const names = stderr.trimEnd().split("\n").slice(1);
  expect(names).toContain("  typed");
  expect(names).toContain("  typed on one thread");
  expect(names.length).toBeGreaterThan(10);
  expect(names.filter(name => name.includes(","))).toEqual([]);
  expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
});

test("a scenario is chosen by its whole name, and nothing else runs", async () => {
  const { stdout, stderr, exitCode } = await benchmark("--scenarios=typed on one thread", "--sizes=300", "--runs=1");
  // A run that fails shows all that it printed. On Windows the benchmark looked for `app`, where a build writes `app.exe`, and this test said only that a line was missing.
  const told = stderr.split(/\r?\n/).filter(line => line.startsWith("300 "));
  expect({ told, exitCode, stderr: exitCode === 0 ? "" : stderr }).toEqual({
    told: [expect.stringMatching(/^300 typed on one thread: /)],
    exitCode: 0,
    stderr: "",
  });
  expect(stdout).toContain(
    "\ntyped on one thread  bun build --compile --aot --explain=statistics --aot-threads=1 main.ts --outfile app\n",
  );
}, 120_000);
