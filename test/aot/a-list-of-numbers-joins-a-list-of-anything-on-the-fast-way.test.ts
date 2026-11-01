import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "node:path";
import { countsInstructions, measureCommand } from "./analysis-scaling/measure-check";
import { test } from "./supported";

// What TypeScript writes for `[...list, i]` where the target is ES5.
const files = {
  "main.js": `
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
var list = [1, 2, 3];
function turn(i) {
  var v = __spreadArray(__spreadArray([], list, true), [i], false);
  return v.length + v[3];
}
var rounds = Number(process.argv[2]), sum = 0;
for (var i = 0; i < rounds; i++) sum += turn(i & 7);
console.log(sum / rounds);
`,
};

test.skipIf(isDebug || isASAN || !countsInstructions())(
  "concat of lists that are stored differently fills no array one element at a time",
  async () => {
    using dir = tempDir("aot-numbers-join-anything", files);
    const executable = join(String(dir), "main");
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", executable],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([build.stderr.text(), build.exited]);
    expect({ stderr: stderr.split("\n").filter(line => line.startsWith("error")), exitCode }).toEqual({
      stderr: [],
      exitCode: 0,
    });
    const env = { ...bunEnv, BUN_JSC_useConcurrentGC: "0", BUN_JSC_numberOfGCMarkers: "1" };
    const [few, many] = [40_000, 240_000];
    const costs: number[] = [];
    for (const rounds of [few, many]) {
      let least = Infinity;
      for (let reading = 0; reading < 3; reading++) {
        const run = await measureCommand(String(dir), [executable, String(rounds)], 120_000, env);
        expect(run.stdout).toBe("7.5\n");
        if (run.instructions === undefined) return void console.error("SKIPPED: instructions cannot be counted here");
        least = Math.min(least, run.instructions);
      }
      costs.push(least);
    }
    const aTurn = (costs[1] - costs[0]) / (many - few);
    console.error(`a turn, two calls of concat: ${aTurn.toFixed(1)} instructions`);
    // About 1,470 on x64. It took 2,990 while the second call made an empty array and filled it.
    expect(aTurn).toBeLessThan(2_200);
  },
  240_000,
);
