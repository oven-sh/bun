// shell/quick.py as a test, for the programs that ask the `jsc` shell what compiled code did while it ran: how often it called an operation of the run time
// (aotOperationCount), how many cells of a kind there are (memoryUsageStatistics). Bun has no such function. Most of these programs take 0 for every count where the function
// is missing, so an executable shows that their answers are right and only the shell shows what they are about. The compiler answers `typeof aotOperationCount` when it builds a
// program, by Bun's table of built-ins: KNOWS_SHELL_FUNCTIONS of shell/quick.py leaves the question to the run. The others have `"onlyInShell"` in their .json, and nothing else runs them.
// shell/tools.ts says what the script needs.
//   JSC=.. TESTAOT=.. FRONT_END=.. PLAIN=.. python3 test/aot/shell/quick.py calls/constructions-avoid-runtime     one program
import { expect, test } from "bun:test";
import { availableParallelism } from "os";
import { join } from "path";
import { run } from "./harness/run";
import { unsupported, writeProgramsThatAskTheShell } from "./run-programs";
import { python, scriptEnvironment, scriptSkipReason } from "./shell/tools";

export function programsThatAskTheShell(part: number, parts: number) {
  if (scriptSkipReason && !unsupported)
    console.error(`SKIPPED: test/aot/programs-that-ask-the-shell-${part}.test.ts: ${scriptSkipReason}`);

  const { names, onlyThere, written } = scriptSkipReason
    ? { names: [], onlyThere: [], written: undefined }
    : writeProgramsThatAskTheShell(part, parts);

  test.skipIf(!!scriptSkipReason)(
    `they print in the shell what is stored for them, or what plain Bun prints (part ${part} of ${parts})`,
    async () => {
      const jobs = String(Number(process.env.AOT_PROGRAMS_JOBS) || availableParallelism());
      const { stdout, stderr, exitCode } = await run(
        [python!, join(import.meta.dir, "shell", "quick.py"), "-j", jobs, ...names],
        undefined,
        { ...scriptEnvironment(), WRITTEN: written, KNOWS_SHELL_FUNCTIONS: "1" },
      );
      expect(stderr).toBe("");
      const lines = stdout.split("\n").filter(line => line !== "");
      const isSame = (line: string) => /^[^ ]+: same \([0-9]+ lines\)$/.test(line);
      // The shell lacks what some of them need of Bun. An executable runs those.
      const isSkipped = (line: string) => /^[^ ]+: skipped: /.test(line) && !onlyThere.includes(line.split(": ")[0]);
      expect(lines.filter(line => !isSame(line) && !isSkipped(line))).toEqual([]);
      expect(lines.map(line => line.split(": ")[0])).toEqual(names);
      expect(exitCode).toBe(0);
    },
    290_000,
  );
}
