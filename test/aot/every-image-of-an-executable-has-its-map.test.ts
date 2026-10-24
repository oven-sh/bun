// Each entry point of an executable is compiled into an image of its own. The map of the code that a build writes and the map that perf reads name the functions of every one of them.
import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDirWithBunTypes as tempDir } from "harness";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { built, slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

const files = {
  "main.ts": `const worker = new Worker("./beside.ts");
worker.onmessage = event => {
  console.log(process.pid, event.data);
  worker.terminate();
};
worker.postMessage(20);
`,
  "beside.ts": `declare var self: Worker;
function twice(n: number) {
  return n * 2;
}
self.onmessage = event => postMessage(twice(event.data));
`,
};

const build = async (folder: string, env: Record<string, string> = {}) =>
  built(
    await spawned([bunExe(), "build", "--compile", "--aot", "main.ts", "beside.ts", "--outfile", "app"], folder, {
      ...bunEnv,
      ...env,
    }),
  );

describe("compile/aot/every-image-of-an-executable-has-its-map", () => {
  test(
    "the build's map",
    () =>
      slot(async () => {
        using dir = tempDir("aot-every-image-has-its-map", files);
        const folder = String(dir);
        const map = join(folder, "code.map");
        await build(folder, { BUN_JSC_aotMapFilePath: map });
        const functionsOf = (path: string) =>
          readFileSync(path, "utf8")
            .split("\n")
            .filter(line => line.startsWith("F\t"))
            .map(line => line.split("\t"))
            .map(fields => `${fields[7]} ${fields[10].split(/[\\/]/).at(-1)}`);
        const maps = [functionsOf(map), functionsOf(`${map}.1`)];
        expect(maps.filter(functions => functions.includes("twice beside.ts")).length).toBeGreaterThan(0);
        expect(maps.filter(functions => functions.some(name => name.endsWith(" main.ts"))).length).toBeGreaterThan(0);
        expect(maps[0]).not.toEqual(maps[1]);
      }),
    240_000,
  );

  (isLinux ? test : test.skip)(
    "perf's map",
    () =>
      slot(async () => {
        using dir = tempDir("aot-every-image-has-its-perf-map", files);
        const folder = String(dir);
        await build(folder);
        const run = await spawned([join(folder, "app")], folder, { ...bunEnv, BUN_JSC_useAOTPerfMap: "1" });
        const [pid, answer] = run.stdout.trim().split(" ");
        expect({ answer, exitCode: run.exitCode, stderr: run.stderr }).toEqual({
          answer: "40",
          exitCode: 0,
          stderr: "",
        });
        const perfMap = `/tmp/perf-${pid}.map`;
        const names = readFileSync(perfMap, "utf8");
        rmSync(perfMap);
        expect(names).toContain(" (module) main.ts:1\n");
        expect(names).toContain(" twice beside.ts:2\n");
      }),
    240_000,
  );
});
