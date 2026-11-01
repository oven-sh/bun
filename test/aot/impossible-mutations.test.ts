import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { runsWholeGrids } from "./harness/ways";
import { test } from "./supported";

// The run time asks every change of a compiled object against what the compiler concluded never happens, in every build. A sabotage brings a false conclusion back.
// What each program prints where the conclusion is right, ./run-parallel.ts holds against plain Bun.
const folder = join(import.meta.dir, "parallel", "classes-reached-through-instances");
// One witness for each kind of change.
const witnesses = {
  "climbed-add.mjs": ["AddProperty of fresh", "added a property to an object"],
  "climbed-link.mjs": ["ChangePrototype", "changed the prototype of an object"],
};
const others = {
  "climbed-index.mjs": ["AddProperty of 0", "added a property to an object"],
  "climbed-method.mjs": ["AddProperty of who", "added a property to an object"],
};
// A sanitizer ends the process in its own way, and Windows has exit codes alone.
const endsBySignal = !isASAN && !isWindows;

async function run(command: string[], cwd: string) {
  await using child = Bun.spawn({
    cmd: command,
    cwd,
    env: { ...bunEnv, BUN_ENABLE_CRASH_REPORTING: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode, signal: child.signalCode };
}

for (const [program, [jargon, plain]] of Object.entries(runsWholeGrids ? { ...witnesses, ...others } : witnesses)) {
  test.concurrent(
    `${program} stops with words where the conclusion is false`,
    async () => {
      using dir = tempDir("impossible-mutations", {});
      const exe = join(String(dir), isWindows ? "sabotaged.exe" : "sabotaged");
      const build = await run(
        [
          bunExe(),
          "build",
          "--compile",
          "--aot",
          "--aot-sabotage=NothingClimbsAboveInstances",
          join(folder, program),
          "--outfile",
          exe,
        ],
        String(dir),
      );
      expect({ stderr: build.stderr, exitCode: build.exitCode }).toMatchObject({ exitCode: 0 });
      const ran = await run([exe], String(dir));
      if (endsBySignal) expect(ran.signal).toBe("SIGABRT");
      else expect(ran.exitCode).not.toBe(0);
      expect(ran.stderr).toContain(`AOT: ${jargon}`);
      expect(ran.stderr).toContain("on an object of layout 0 (B), which the compiler assumed never happens");
      expect(ran.stderr).toContain(`AOT: The program ${plain}, which is allowed.`);
      expect(ran.stderr).toContain(
        "AOT: This is a bug in Bun. Please report it with these lines: https://github.com/oven-sh/bun/issues",
      );
      expect(ran.stderr).toContain("AOT: Until it is fixed, build with --aot-disable=flow-results");
    },
    120_000,
  );
}
