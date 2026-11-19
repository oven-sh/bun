// A generator writes one function of many thousands of like parts. The work of the build grows with the length of the function: each program is built at half its length and at its
// whole length, and the instructions of the two builds are compared, so the answer is the same on a busy machine.
import { expect } from "bun:test";
import { bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "node:path";
import { countsInstructions, measureCommand } from "./analysis-scaling/measure-check";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const n = isDebug || isASAN ? 4_000 : 16_000;
const parts = (length: number, part: (k: number) => string) => Array.from({ length }, (_, k) => part(k)).join("");
const inOneFunction = (body: string) =>
  `function run(o, r, i) {\n${body}\n  return r.length;\n}\nconsole.log(run({ f: 1, g: 2, s: "x" }, [], 0));\n`;

/** Twice the length may cost this many times the instructions. Work that grows with the square of the length costs four times as many, with the cube eight times. */
const mostGrowth = 2.5;
const limit = 600_000;

async function run(cwd: string, cmd: string[]) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd);
  return { stdout, stderr, exitCode };
}

const instructionsOf = async (cwd: string, cmd: string[]) => (await measureCommand(cwd, cmd, limit)).instructions;

type Program = {
  file: string;
  length: number;
  source(length: number): string;
  /** What the executable prints. Without it the program is only checked: the front end alone. */
  prints?(length: number): string;
};

async function growsWithItsLength({ file, length, source, prints }: Program) {
  const counted: (number | undefined)[] = [];
  for (const size of [length / 2, length]) {
    using dir = tempDir("long-generated-functions", { [file]: source(size) });
    const outfile = join(String(dir), "out");
    const command = prints
      ? ["build", "--compile", "--aot", "./" + file, "--outfile", outfile]
      : ["check", "--aot", "./" + file];
    counted.push(await instructionsOf(String(dir), [bunExe(), ...command]));
    if (prints) expect(await run(String(dir), [outfile])).toEqual({ stdout: prints(size), stderr: "", exitCode: 0 });
  }
  const [half, whole] = counted;
  if (half === undefined || whole === undefined) return;
  const told = `${length / 2} parts take ${half} instructions, ${length} parts take ${(whole / half).toFixed(2)} times as many`;
  expect(whole / half < mostGrowth ? "" : told).toBe("");
}

test.skipIf(!countsInstructions())(
  "a switch of numbers as long as a generator writes it is built in time that grows with its length",
  () =>
    growsWithItsLength({
      file: "main.js",
      length: n,
      source: length =>
        inOneFunction(`  switch (i) {\n${parts(length, k => `    case ${k + 1}: r.push(${k}); break;\n`)}  }`),
      prints: () => "0\n",
    }),
  limit,
);
