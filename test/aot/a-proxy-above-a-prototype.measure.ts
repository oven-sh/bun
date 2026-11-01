// A proxy that is hung above an object that may be a prototype changes what the objects below find under an index, so those that hold elements are looked for and converted.
// An executable does that for the objects below the proxy alone, each time, where plain Bun makes every array of the realm slow once and for all.
// What is looked for has a Structure that says so, and those Structures are kept in a list: the objects of the heap are gone through only where one of them is below the proxy. So what one more proxy costs does not grow with the number of objects that are alive.
import { expect } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "path";
import { measureCommand } from "./analysis-scaling/measure-check";
import { slot, spawned, withoutDebugInformation } from "./harness/commands";
import { withSteadyCollections } from "./harness/counted-run";
import { describe, test } from "./supported";

const root = join(import.meta.dir, "a-proxy-above-a-prototype");

async function withExecutable(run: (executable: string) => Promise<void>) {
  const folder = String(tempDir("aot-a-proxy-above-a-prototype", {}));
  const executable = join(folder, "installs");
  try {
    const build = await spawned(
      [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        ...withoutDebugInformation(),
        join(root, "installs.js"),
        "--outfile",
        executable,
      ],
      root,
      bunEnv,
    );
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
      stderr: expect.not.stringMatching(/^error\b/m),
      exitCode: 0,
    });
    await run(executable);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

// The instructions that one more install costs between `few` and `many` of them, beside so many objects. Undefined where instructions cannot be counted.
async function instructionsForOneMore(executable: string, few: number, many: number, objects: number) {
  const costs: number[] = [];
  for (const installs of [few, many]) {
    const run = await measureCommand(root, [executable, String(installs), String(objects)], 300_000, {
      ...bunEnv,
      ...withSteadyCollections,
    });
    expect(run.stdout.trim()).toBe(String(installs + objects));
    if (run.instructions === undefined) return void console.error("SKIPPED: instructions cannot be counted here");
    costs.push(run.instructions);
  }
  return Math.round((costs[1] - costs[0]) / (many - few));
}

describe.skipIf(isDebug || isASAN || isWindows)("compile/aot/a-proxy-above-a-prototype", () => {
  test(
    "what one more proxy above a prototype object costs does not grow with the objects that are alive",
    () =>
      slot(() =>
        withExecutable(async executable => {
          const besideNone = await instructionsForOneMore(executable, 100, 400, 0);
          const besideAMillion = await instructionsForOneMore(executable, 100, 400, 1_000_000);
          if (besideNone === undefined || besideAMillion === undefined) return;
          console.error(
            `A PROXY ABOVE A PROTOTYPE\tinstructions for one more: ${besideNone} beside no object, ${besideAMillion} beside a million`,
          );
          expect(besideAMillion).toBeLessThan(besideNone * 2);
        }),
      ),
    900_000,
  );

  test(
    "what one more proxy above a prototype object costs does not grow with the classes that were made before it",
    () =>
      slot(() =>
        withExecutable(async executable => {
          const early = await instructionsForOneMore(executable, 1_000, 2_000, 0);
          const late = await instructionsForOneMore(executable, 16_000, 17_000, 0);
          if (early === undefined || late === undefined) return;
          console.error(
            `A PROXY ABOVE A PROTOTYPE\tinstructions for one more: ${early} behind a thousand classes, ${late} behind sixteen thousand`,
          );
          expect(late).toBeLessThan(early * 2);
        }),
      ),
    900_000,
  );
});
