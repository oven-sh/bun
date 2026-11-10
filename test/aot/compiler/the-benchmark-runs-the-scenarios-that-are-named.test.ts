// bench/compiler/run.ts takes `--scenarios=<name>,<name>`. Seven of its names held a comma themselves ("typed, one thread"), so none of them could be chosen, and a name that it
// does not have was passed over in silence: `--scenarios="typed, one thread"` ran "typed", on every thread, and printed its numbers.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync } from "node:fs";
import { join } from "node:path";
import { run } from "../harness/run";
import { test } from "../supported";

const script = join(import.meta.dir, "..", "..", "..", "bench", "compiler", "run.ts");
// The build of 500 lines takes a second. On a small runner of macOS, where CI starts this file beside one that fills the memory for 100 seconds, it passed 120.
const whileTheMachineIsBusy = 300_000;
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

// It asks for the commands and builds nothing: the build on one thread passed 120 seconds on a busy runner of macOS, where it takes six on Linux.
test("a scenario is chosen by its whole name, and no other", async () => {
  expect(await benchmark("--scenarios=typed on one thread", "--commands")).toMatchObject({
    stdout:
      "typed on one thread  bun build --compile --aot --explain=statistics --aot-threads=1 main.ts --outfile app\n",
    stderr: "",
    exitCode: 0,
  });
});

// Go adds no `.exe` to a name that it is given: on Windows the benchmark looked for an `app.exe` that nobody had written, and ended there, behind minutes of work.
test("Go is told the name under which its executable is looked for", async () => {
  const { stdout } = await benchmark("--scenarios=go-cold,go-std-warm", "--commands");
  const name = isWindows ? "app.exe" : "app";
  expect(stdout.split("\n").map(line => / -o (\S+) /.exec(line)?.[1])).toEqual([name, name, undefined]);
});

// A formatter that is not there, and a step in front of a build that fails, ended the whole benchmark: what it had measured until then was printed nowhere.
test.skipIf(isWindows)(
  "a scenario without its formatter is left out, one whose preparation fails has a row, and what was measured is printed",
  async () => {
    using tools = tempDir("tools-of-the-benchmark", {
      cargo: "#!/bin/sh\nexit 0\n",
      go: "#!/bin/sh\necho there is no standard library >&2\nexit 1\n",
      gofmt: "#!/bin/sh\nexit 0\n",
    });
    for (const tool of ["cargo", "go", "gofmt"]) chmodSync(join(String(tools), tool), 0o755);
    const words = ["--scenarios=typed,go-std-warm,cargo build", "--sizes=300", "--runs=1"];
    const env = { ...bunEnv, PATH: String(tools) };
    const { stdout, stderr, exitCode } = await run([bunExe(), script, ...words], import.meta.dir, env);
    const told = stderr.split("\n").filter(line => /^300 |left out$/.test(line));
    expect({ told, exitCode, stderr: exitCode === 0 ? "" : stderr }).toEqual({
      told: [
        expect.stringMatching(/^300 typed: /),
        "300 go-std-warm: FAILED: there is no standard library",
        "cargo build: no rustfmt on this machine: left out",
      ],
      exitCode: 0,
      stderr: "",
    });
    expect(stdout).toMatch(/\ntyped +\d/);
    expect(stdout).toContain("\ngo-std-warm  FAILED: there is no standard library\n");
  },
  whileTheMachineIsBusy,
);

test(
  "what is chosen is built and measured, and nothing else",
  async () => {
    const { stdout, stderr, exitCode } = await benchmark("--scenarios=typed", "--sizes=300", "--runs=1");
    // A run that fails shows all that it printed. On Windows the benchmark looked for `app`, where a build writes `app.exe`, and this test said only that a line was missing.
    const told = stderr.split(/\r?\n/).filter(line => line.startsWith("300 "));
    expect({ told, exitCode, stderr: exitCode === 0 ? "" : stderr }).toEqual({
      told: [expect.stringMatching(/^300 typed: /)],
      exitCode: 0,
      stderr: "",
    });
    expect(stdout).toContain("\ntyped     bun build --compile --aot --explain=statistics main.ts --outfile app\n");
  },
  whileTheMachineIsBusy,
);
