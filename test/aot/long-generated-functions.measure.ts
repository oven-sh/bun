// A generator writes one function of many thousands of like parts. The work of the build grows with the length of the function: each program is built at half its length and at its
// whole length, and the instructions of the two builds are compared, so the answer is the same on a busy machine. Where instructions cannot be counted, the time limit of the test stands alone.
import { expect } from "bun:test";
import { bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { measureCommand } from "./analysis-scaling/measure-check";
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

async function instructionsOf(cwd: string, cmd: string[]) {
  if (!isWindows) return (await measureCommand(cwd, cmd, limit)).instructions;
  const ran = await run(cwd, cmd);
  expect({ stderr: ran.exitCode ? ran.stderr : "", exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
}

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
    const outfile = join(String(dir), "out" + (isWindows ? ".exe" : ""));
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

test(
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

// TODO: twice the length costs 2.44 times the instructions, which is too near the bound to be held to it.
test.todo(
  "try blocks whose catch clauses hand their parameters on, as many as a generator writes",
  () =>
    growsWithItsLength({
      file: "main.js",
      length: n,
      source: length => inOneFunction(parts(length, () => "  try { r.push(o.f); } catch (e) { r.push(e); }\n")),
      prints: length => length + "\n",
    }),
  limit,
);

// TODO: twice the length costs 3.2 times the instructions.
test.todo(
  "loops in a row, as many as a generator writes, are translated in time that grows with their number",
  () =>
    growsWithItsLength({
      file: "main.js",
      length: n,
      source: length => inOneFunction(parts(length, k => `  for (var j${k} = 0; j${k} < 1; j${k}++) r.push(j${k});\n`)),
    }),
  limit,
);

// TODO: twice the length costs 3.3 times the instructions.
test.todo(
  "large `as const` table compiles in linear time",
  () =>
    growsWithItsLength({
      file: "main.ts",
      length: n,
      source: length =>
        `const table = [\n${parts(length, k => `  { id: ${k}, name: "n${k}", on: ${k % 2 === 1} },\n`)}] as const;\nexport let total = 0;\nfor (const row of table) total += row.id;\nexport const second = table[1].name;\n`,
    }),
  limit,
);

// TODO: twice the length costs 3.1 times the instructions.
test.todo(
  "a typed function that a loop calls and that joins strings in a chain as long as a generator writes it is built in time that grows with its length",
  () =>
    growsWithItsLength({
      file: "main.ts",
      length: n,
      source: length =>
        `function build(a: string, n: number): string {\n  let s = a;\n${parts(length, () => "  s = s + n + a;\n")}  return s;\n}\nlet total = 0;\nfor (let i = 0; i < 3; i++) total += build("ab", i).length;\nconsole.log(total);\n`,
      prints: length => 3 * (2 + 3 * length) + "\n",
    }),
  limit,
);
