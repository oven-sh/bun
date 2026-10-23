// A proxy that is hung above an object that may be a prototype changes what the objects below find under an index, so those that hold elements are looked for and converted.
// An executable does that for the objects below the proxy alone, each time, where plain Bun makes every array of the realm slow once and for all.
// What is looked for has a Structure that says so: the objects of the heap are gone through only where such a Structure is below the proxy. So what one more proxy costs does not grow with the number of objects that are alive.
import { expect } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "path";
import { measureCommand } from "./analysis-scaling/measure-check";
import { withSteadyCollections } from "./harness/counted-run";
import { slot, spawned, withoutDebugInformation } from "./run-programs";
import { describe, test } from "./supported";

const root = join(import.meta.dir, "a-proxy-above-a-prototype");

describe.skipIf(isDebug || isASAN || isWindows)("compile/aot/a-proxy-above-a-prototype", () => {
  test(
    "what one more proxy above a prototype object costs does not grow with the objects that are alive",
    () =>
      slot(async () => {
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

          const env = { ...bunEnv, ...withSteadyCollections };
          const [few, many] = [100, 400];
          const instructionsPerInstall: Record<number, number> = {};
          for (const objects of [0, 1_000_000]) {
            const costs: number[] = [];
            for (const installs of [few, many]) {
              const run = await measureCommand(root, [executable, String(installs), String(objects)], 300_000, env);
              expect(run.stdout.trim()).toBe(String(installs + objects));
              if (run.instructions === undefined)
                return void console.error("SKIPPED: instructions cannot be counted here");
              costs.push(run.instructions);
            }
            instructionsPerInstall[objects] = Math.round((costs[1] - costs[0]) / (many - few));
          }
          console.error(
            `A PROXY ABOVE A PROTOTYPE\tinstructions for one more: ${instructionsPerInstall[0]} beside no object, ${instructionsPerInstall[1_000_000]} beside a million`,
          );
          expect(instructionsPerInstall[1_000_000]).toBeLessThan(instructionsPerInstall[0] * 2);
        } finally {
          rmSync(folder, { recursive: true, force: true });
        }
      }),
    900_000,
  );
});
