// Some programs in parallel/ print how often compiled code called into the run time. They ask aotOperationCount() and its kin, which only
// the `jsc` shell has: in an executable there is no such function, and nothing that they say about a count is held by what it prints.
// shell/quick.py runs them in the shell, where the counts are real, and they must print what plain Bun prints, where every count is 0.
// shell/counts-known.txt lists those that do not today. shell/tools.ts says what the scripts need.
// run-parallel.ts and shell/expectations.py ask the same of a program that they are given, where there is a shell. A shard of CI that runs programs
// need not have one: this test holds all of them wherever Bun has the compiler.
import { expect } from "bun:test";
import { join } from "path";
import { unsupported } from "./harness/commands";
import { test } from "./harness/declare";
import { run } from "./harness/run";
import { python, scriptEnvironment, scriptSkipReason } from "./shell/tools";

if (scriptSkipReason && !unsupported)
  console.error(`SKIPPED: test/aot/counts-pinned-by-programs.test.ts: ${scriptSkipReason}`);

test.skipIf(!!scriptSkipReason)(
  "the counts hold in the shell",
  async () => {
    const { stdout, stderr, exitCode } = await run(
      [python!, join(import.meta.dir, "shell", "quick.py"), "counting"],
      undefined,
      scriptEnvironment(),
    );
    expect(stderr).toBe("");
    const lines = stdout.split("\n").filter(line => line !== "");
    const todo = lines.filter(line => line.includes(": skipped: TODO: "));
    if (todo.length) console.error(todo.join("\n"));
    // A program that the shell cannot run fails too: nothing else holds its counts.
    expect(lines.filter(line => !todo.includes(line) && !/^[^ ]+: same \([0-9]+ lines\)$/.test(line))).toEqual([]);
    expect(lines).not.toBeEmpty();
    expect(exitCode).toBe(0);
  },
  290_000,
);
