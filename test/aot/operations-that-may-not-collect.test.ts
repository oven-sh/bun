// Compiled code counts on no collection across some calls into the run time: it leaves out a write barrier on an object that it has just made, or calls while a cell is half filled.
// An image built with validation aborts when such a call comes back and a collection has begun or ended meanwhile. A collector that asks from another thread is what finds these
// places: a collection that is forced at an allocation is skipped while collections are deferred, and these operations stopped where a deferral ended.
// engine-tests/validation/*-beside-a-collector.ir start three more programs so in the engine's shell.
import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { withoutCoreDump } from "./harness/commands";
import { run } from "./harness/run";
import { describe, test } from "./supported";

describe.skipIf(isASAN || isDebug).concurrent("compile/aot/operations that may not collect", () => {
  const dir = tempDir("aot-operations-that-may-not-collect", {});
  const cwd = String(dir);
  afterAll(() => dir[Symbol.dispose]());

  const startsAsPlainBun = async (_: string, folder: string, name: string, starts: number) => {
    copyFileSync(join(import.meta.dir, "parallel", folder, name), join(cwd, name));
    const plain = await run([bunExe(), name], cwd);
    expect(plain.exitCode).toBe(0);
    const executable = join(cwd, name + (isWindows ? ".exe" : ".out"));
    const built = await run(
      [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        "--no-builtin-modules",
        "--aot-check=validate",
        name,
        "--outfile",
        executable,
      ],
      cwd,
    );
    expect(built.stderr).not.toContain("error:");
    expect(built.exitCode).toBe(0);
    const wrong: unknown[] = [];
    for (let first = 0; first < starts; first += 8) {
      const rans = await Promise.all(
        Array.from({ length: 8 }, () =>
          run(withoutCoreDump([executable]), cwd, {
            ...bunEnv,
            BUN_JSC_collectContinuously: "1",
            BUN_JSC_forceDidDeferGCWork: "1",
          }),
        ),
      );
      for (const ran of rans)
        if (ran.exitCode || ran.stdout !== plain.stdout)
          wrong.push({ exitCode: ran.exitCode, stderr: ran.stderr.split("\n").slice(0, 3) });
    }
    expect(wrong).toEqual([]);
  };

  // TODO: on Windows an executable in which the collector asks from another thread all the time does not end within four minutes.
  test.todoIf(isWindows).each([
    ["a method read at an allocation site's record", "objects", "every-way-allocation-site-meets-record.ts", 8],
    ["an async function that throws", "async", "async-throw-after-await.ts", 8],
  ])("%s", startsAsPlainBun, 240_000);
});
