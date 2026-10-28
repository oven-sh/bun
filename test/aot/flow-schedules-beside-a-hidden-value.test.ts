// ./flow-schedules.test.ts says what a schedule is. Here small programs whose answer once hung on it.
import { expect, setDefaultTimeout } from "bun:test";
import { bunExe, tempDir } from "harness";
import { cpSync } from "node:fs";
import { join } from "node:path";
import { buildUnderEachSchedule, run } from "./harness/flow-schedules";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

setDefaultTimeout(600_000);

async function answersTheSameUnderEachSchedule(name: string, directory: string, entry: string) {
  const built = await buildUnderEachSchedule(name, directory, entry);
  const answers = await Promise.all(built.map(it => run([it.executable], directory)));
  for (const answer of answers) expect(answer).toEqual(answers[0]);
  return answers[0];
}

// An object of the host, the exports of a library module or an evaluator stands beside a value nobody knows at a parameter that is handed on to unknown code. Which of its members are kept and unlocked hangs on whether the
// parameter lists it. Once a parameter that held the value nobody knows took no more, so the answer hung on which of the two came first: on the number of calls in between, and, where both came at once, on the schedule.
for (const program of [
  "exports-library-modules-hidden-value",
  "object-namespace-object-escaped-exports",
  "library-module-arrives-late-hidden-value",
  "class-module-bun-makes-named-long-bun",
  "evaluators-loader-hidden-value-called",
  "members-process-stored-process-arrives",
  "members-string-prototype-replaced",
  // Of another kind: a bound function is handed to the host, and which other functions are handed out at the same time is the schedule's.
  "listener-object-holds-object-assign",
]) {
  test(`${program}: as plain Bun under every schedule`, async () => {
    using dir = tempDir("aot-flow-schedules-listed", {});
    const directory = String(dir);
    cpSync(join(import.meta.dir, "parallel", "soundness", `${program}.mjs`), join(directory, "program.mjs"));
    expect(await answersTheSameUnderEachSchedule("program", directory, "program.mjs")).toEqual(
      await run([bunExe(), "program.mjs"], directory),
    );
  });
}

// An object of the host is not followed that far. Where `process` and the value nobody knows come at once, which is first is the schedule's: the stores go through, or the first of them is refused, as the page says of
// built-in objects. Nothing else happens, and under the usual schedule they go through.
test("members-of-process-are-stored-where-process-stands-beside-a-hidden-value: as plain Bun, or refused, under every schedule", async () => {
  using dir = tempDir("aot-flow-schedules-listed", {});
  const directory = String(dir);
  cpSync(
    join(import.meta.dir, "parallel", "soundness", "members-process-stored-process-hidden.mjs"),
    join(directory, "program.mjs"),
  );
  const plain = await run([bunExe(), "program.mjs"], directory);
  const built = await buildUnderEachSchedule("program", directory, "program.mjs");
  const answers = await Promise.all(built.map(it => runCommand([it.executable], directory)));
  expect({ stdout: answers[0].stdout, exitCode: answers[0].exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  for (const { stdout, stderr, exitCode } of answers) {
    const isRefused =
      stdout === "" && exitCode === 1 && stderr.includes("built-in objects are read-only in a compiled executable");
    expect({ stdout, exitCode, isRefused }).toEqual(
      isRefused ? { stdout: "", exitCode: 1, isRefused } : { stdout: plain.stdout, exitCode: 0, isRefused },
    );
  }
});
