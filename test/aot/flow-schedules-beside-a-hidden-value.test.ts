// ./harness/flow-schedules.ts says what a schedule is. Here small programs whose answer once hung on it.
import { expect, setDefaultTimeout } from "bun:test";
import { bunExe, tempDir } from "harness";
import { cpSync } from "node:fs";
import { join } from "node:path";
import { buildUnderEachSchedule, run } from "./harness/flow-schedules";
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
