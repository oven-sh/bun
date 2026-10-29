import { expect } from "bun:test";
import { bunEnv, bunExe, isArm64, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { describe, test } from "./supported";

// Temporary: forms of two cases of heap-limit.test.ts. Where an answer is wrong a form also prints how far each fill got.

const helpers = `let sink = 0;
function leaf(n) {
  sink += n & 1;
  return n + 1;
}
function manyAlive(n) {
  let a = n + 1, b = n + 2, c = n + 3, d = n + 4, e = n + 5, f = n + 6, g = n + 7, h = n + 8, i = n + 9, j = n + 10, k = n + 11, l = n + 12, m = n + 13, o = n + 14;
  for (let turn = 0; turn < 3; turn++) {
    a += leaf(b); b += leaf(c); c += leaf(d); d += leaf(e); e += leaf(f); f += leaf(g); g += leaf(h);
    h += leaf(i); i += leaf(j); j += leaf(k); k += leaf(l); l += leaf(m); m += leaf(o); o += leaf(a);
  }
  return a + b + c + d + e + f + g + h + i + j + k + l + m + o;
}
function down(depth) {
  if (depth === 0) return manyAlive(depth);
  const below = down(depth - 1);
  sink += depth & 1;
  return below + 1;
}
`;

const cells = (afterCatch: string, depth: number) => `${helpers}let keep = [];
const fills = [["cells", (turns, most) => { for (let i = 0; i < turns; i++) { keep.push({ a: i, b: i, c: i }); if (keep.length >= most) keep = []; } }]];
function below(depth, fill, turns, most) {
  if (depth === 0) return fill(turns, most);
  below(depth - 1, fill, turns, most);
  sink += depth & 1;
}
function run(fill, turns, most) {
  keep = [];
  try {
    below(${depth}, fill, turns, most);
    return "no error";
  } catch (error) {
    const kept = keep.length;
    keep = [];
    ${afterCatch}
    return error instanceof RangeError ? kept : String(error);
  }
}
const fill = fills[0][1];
const counts = [0, 1, 2].map(() => run(fill, Infinity, Infinity));
console.log(counts[0] > 10_000, counts.map(count => count >= counts[0] * 0.9).join(" "));
if (!counts.every(count => count >= counts[0] * 0.9)) console.log("kept", counts.join(" "));
console.log(run(fill, Infinity, Infinity) > 10_000, run(fill, 300_000, 1000));
`;

const shapes = (afterCatch: string, depth: number) => `${helpers}let keep = [];
function fill() {
  for (let i = 0; ; i++) {
    const object = { a: 1 }; Object.setPrototypeOf(object, {});
    keep.push(object);
  }
}
function below(depth) {
  if (depth === 0) return fill();
  below(depth - 1);
  sink += depth & 1;
}
const kept = [];
for (let attempt = 0; attempt < 4; attempt++) {
  try {
    below(${depth});
  } catch (error) {
    kept.push(keep.length);
    keep = [];
    ${afterCatch}
    if (!(error instanceof RangeError)) console.log(String(error));
  }
}
console.log(kept.map(count => count > 10_000 && count * 2 > kept[0]).join());
if (!kept.every(count => count > 10_000 && count * 2 > kept[0])) console.log("kept", kept.join(" "));
`;

const kinds = [
  {
    kind: "cells",
    program: cells,
    env: { BUN_JSC_markedBlockCageSizeInMB: "64" },
    expected: "true true true true\ntrue no error\n",
  },
  {
    kind: "shapes",
    program: shapes,
    env: { BUN_JSC_structureHeapSizeInKB: "16384" },
    expected: "true,true,true,true\n",
  },
];
const forms: [string, string, number, string[]][] = [
  ["as it is", "", 0, []],
  ["many numbers are alive behind each catch", "sink += manyAlive(1) & 1;", 0, []],
  ["calls go 300 deep behind each catch", "sink += down(300) & 1;", 0, []],
  ["filled 300 calls down", "", 300, []],
  ["without preferred registers", "", 0, ["--aot-disable=b3:ChargeForCalleeSaves,b3:PreferredRegisters"]],
  ["without split live ranges", "", 0, ["--aot-disable=b3:SplitLiveRanges,b3:SplitLiveRangesAroundFrame"]],
];

describe.skipIf(!isWindows || isArm64).concurrent("a program fills as far again", () => {
  for (const { kind, program, env, expected } of kinds) {
    test.each(forms)(
      kind + ": %s",
      async (_, afterCatch, depth, flags) => {
        using folder = tempDir("aot-fills-again", { "program.js": program(afterCatch, depth) });
        const cwd = String(folder);
        const built = await run(
          [bunExe(), "build", "--compile", "--aot", ...flags, "program.js", "--outfile", "program"],
          cwd,
          bunEnv,
        );
        expect(built.exitCode).toBe(0);
        const { stdout, stderr, exitCode } = await run([join(cwd, "program")], cwd, { ...bunEnv, ...env });
        expect({ stdout, stderr, exitCode }).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
      },
      120_000,
    );
  }
});
