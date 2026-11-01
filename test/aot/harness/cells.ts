import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { describe, test } from "../supported";
import { run } from "./run";
import { partOfGrid } from "./ways";

/**
 * One small function that logs what it sees. `row` is what the program's loop is handed beside its name and description.
 * `files` lie in a folder that bears the cell's name.
 */
export type Cell = { id: string; what: string; text: string; row?: string; files?: Record<string, string> };

/** A program that runs the cells one after the other and prints one line for each. */
export function programOf(cells: Cell[], helpers: string, call: string) {
  return `let lines = [], printed = "";
function log(s) { lines.push(s); }
${helpers}${cells.map(cell => cell.text + "\n").join("")}for (const [id, run, how] of [
${cells.map(cell => `  ["${cell.id}", ${cell.id}, ${cell.row ?? "0"}],`).join("\n")}
]) {
  lines = [];
  ${call}
  printed += id + " : " + lines.join(" ") + "\\n";
}
await new Promise(done => process.stdout.write(printed, done));
`;
}

async function printedByPlainBun(dir: string, lines: number) {
  const plain = await run([bunExe(), "run", "./main.mjs"], dir);
  expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const printed = plain.stdout.split(/\r?\n/);
  expect(printed.length).toBe(lines + 1);
  return printed;
}

/**
 * Every cell prints in an executable what it prints under `bun run`, or the line that is stored for it.
 * A table is a tool for finding faults: in front of a merge one cell in `oneIn` runs, another part each day, and every cell on a bench.
 * `always`: cells that run every day, because a fault planted in the compiler (`--aot-sabotage`) turns them wrong: a net that can ring.
 */
export function testCells(
  title: string,
  all: Cell[],
  atOnce: number,
  helpers: string,
  call: string,
  stored?: Map<string, string>,
  oneIn = 20,
  always: string[] = [],
) {
  const part = new Set(partOfGrid(title, all, oneIn, cell => cell.id));
  const cells = all.filter(cell => part.has(cell) || always.includes(cell.id));
  const programs = Array.from({ length: Math.ceil(cells.length / atOnce) }, (_, i) =>
    cells.slice(i * atOnce, i * atOnce + atOnce),
  );
  describe.concurrent(title, () => {
    test.each(programs.map(program => [program[0].id, program] as const))("from %s on", async (_, program) => {
      using dir = tempDir("aot-cells", {
        "main.mjs": programOf(program, helpers, call),
        ...Object.fromEntries(
          program.flatMap(cell => Object.entries(cell.files ?? {}).map(([name, text]) => [`${cell.id}/${name}`, text])),
        ),
      });
      const built = await run(
        [bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", "compiled.exe"],
        String(dir),
      );
      expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
        stderr: "",
        exitCode: 0,
      });
      const compiled = await run([join(String(dir), "compiled.exe")], String(dir));
      expect({ stderr: compiled.stderr, exitCode: compiled.exitCode }).toEqual({ stderr: "", exitCode: 0 });
      const expected = stored
        ? program.map(cell => stored.get(cell.id))
        : await printedByPlainBun(String(dir), program.length);
      const printed = compiled.stdout.split(/\r?\n/);
      expect(
        program.flatMap((cell, i) =>
          printed[i] === expected[i]
            ? []
            : [{ cell: `${cell.id} | ${cell.what}`, expected: expected[i], printed: printed[i] }],
        ),
      ).toEqual([]);
    });
  });
}
