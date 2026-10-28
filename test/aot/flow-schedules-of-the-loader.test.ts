// ./flow-schedules.test.ts says what a schedule is. Here small programs that come at the loader of modules sideways.
import { expect, setDefaultTimeout } from "bun:test";
import { bunExe, tempDir } from "harness";
import { cpSync } from "node:fs";
import { join } from "node:path";
import { buildUnderEachSchedule, run } from "./harness/flow-schedules";
import { pathOfWrittenProgram } from "./run-programs";
import { test } from "./supported";

setDefaultTimeout(600_000);

async function answersTheSameUnderEachSchedule(name: string, directory: string, entry: string) {
  const built = await buildUnderEachSchedule(name, directory, entry);
  const answers = await Promise.all(built.map(it => run([it.executable], directory)));
  for (const answer of answers) expect(answer).toEqual(answers[0]);
  return answers[0];
}

// The loader is reached through a built-in whose meaning is code of the library, one body for all calls. There `process`, or the built-in `call` itself, stands beside a value nobody knows, and once it
// had escaped no rule saw it any more: the executable refused the load ("can't load a module from a dynamic path") under some schedules and not under others.
for (const way of ["by-reflect-get", "by-call-of-call"]) {
  for (const member of ["buffer-is-utf8", "events-get-event-listeners", "fs-stat-sync", "net-is-ipv6"]) {
    const program = pathOfWrittenProgram(`ways-into-library-modules/${member}-through-get-builtin-module-${way}`)!;
    test(`${member}: process.getBuiltinModule ${way} loads the module under every schedule`, async () => {
      using dir = tempDir("aot-flow-schedules-loader", {});
      const directory = String(dir);
      cpSync(program, join(directory, "program.js"));
      expect(await answersTheSameUnderEachSchedule("program", directory, "program.js")).toEqual(
        await run([bunExe(), "program.js"], directory),
      );
    });
  }
}
