// For turns-of-three-statements-*.test.ts. `fuzz/fuzzilli/write-turn-sweep.ts` writes every turn of three small statements, some millions of programs in eleven rows. Here it writes out a few of each row, spread
// over the row, and a few by name. Each is built alone, into an executable of its own: does the build end with an executable, and does that print what `bun <file>` prints?
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ask } from "./everyday-programs";

const writer = join(import.meta.dir, "..", "fuzz", "fuzzilli", "write-turn-sweep.ts");

const rows = [
  "lists",
  "numbers",
  "objects",
  "records",
  "grids",
  "generators",
  "texts",
  "handed",
  "quiet",
  "pairs",
  "held",
];

// The row and the name. A number stands in front of a name; it moves when the row grows.
const byName: [string, string][] = [
  ["lists", "integers-up-read-i-int--store-j-masked--again-i-int"],
  ["lists", "fractions-up-throw--add-at-the-counter--module-takes-t"],
  ["lists", "integers-up-break--carry--module-takes-t"],
  ["quiet", "quiet-integers-that-nobody-knows-down-count-the-marked--read-the-one-before--store-the-next"],
  ["held", "held-a-captured-variable-integers-that-nobody-knows-down-store-t--store-the-next--sum-int"],
];

function written(write: (run: (...args: string[]) => void, folder: string) => void) {
  using dir = tempDir("aot-turns-of-three-statements", {});
  const folder = String(dir);
  write((...args) => {
    const { exitCode, stderr } = Bun.spawnSync({ cmd: [bunExe(), writer, ...args], env: bunEnv, stderr: "pipe" });
    if (exitCode !== 0) throw new Error(`the writer ended with ${exitCode}: ${stderr}`);
  }, folder);
  return readdirSync(folder)
    .sort()
    .map(name => ({ name, text: readFileSync(join(folder, name), "utf8") }));
}

export function turnsOfThreeStatementsIn(part: number, parts: number) {
  // The stride has no factor in common with the length of any row.
  written((run, folder) => rows.forEach(row => run(folder, "1", "24", "104729", row)))
    .filter((_, at) => at % parts === part - 1)
    .forEach(ask);
}

// The writer looks through a row from its start for a name, so these have a test file of their own.
export function turnsOfThreeStatementsByName() {
  written((run, folder) => byName.forEach(([row, name]) => run("named", row, `^\\d+-${name}$`, folder, "1"))).forEach(
    ask,
  );
}
