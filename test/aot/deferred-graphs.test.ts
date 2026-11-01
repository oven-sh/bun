import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll } from "./harness/default-timeout";
import { cellsOf, programOf, ways, type Way } from "./harness/deferred-graphs";
import { run } from "./harness/run";
import { partOfGrid, runsWholeGrids } from "./harness/ways";
import { describe, test } from "./supported";

// deferred-graphs.known.txt: the cells on which an executable does not print today what `bun run` prints. A line goes out when its cell is
// right again, and none may come in. AOT_DEFERRED_GRAPHS_UPDATE=1 writes what a run finds.
// In front of a merge one cell in twenty runs, another part each day, and the first four of the list. On a bench, and where the list is written, all.
const updates = !!process.env.AOT_DEFERRED_GRAPHS_UPDATE;
const list = join(import.meta.dir, "deferred-graphs.known.txt");
const known = new Set(readFileSync(list, "utf8").split(/\r?\n/).filter(Boolean));
const found: string[] = [];
if (updates)
  afterAll(() =>
    writeFileSync(
      list,
      found
        .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
        .map(id => id + "\n")
        .join(""),
    ),
  );

const linesOf = (stdout: string) =>
  new Map(stdout.split(/\r?\n/).map(line => [line.slice(0, line.indexOf(" ")), line]));

async function printedBy(command: string[], dir: string) {
  const { stdout, stderr, exitCode } = await run(command, dir);
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return linesOf(stdout);
}

describe.concurrent.each(Object.keys(ways) as Way[])("graphs with import defer: %s", way => {
  const all = cellsOf(way);
  const witnesses = new Set(all.filter(cell => known.has(cell.id)).slice(0, 4));
  const part = new Set(
    partOfGrid(`graphs with import defer: ${way}`, all, 20, cell => cell.id, undefined, runsWholeGrids || updates),
  );
  const cells = all.filter(cell => witnesses.has(cell) || part.has(cell));
  const programs = Array.from({ length: Math.ceil(cells.length / 1000) }, (_, i) =>
    cells.slice(i * 1000, i * 1000 + 1000),
  );
  test.each(programs.map(program => [program[0].id, program] as const))("from %s on", async (_, program) => {
    const { entry, files } = programOf(way, program);
    using dir = tempDir("aot-deferred-graphs", files);
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", `./${entry}`, "--outfile", "compiled.exe"],
      String(dir),
    );
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    const expected = await printedBy([bunExe(), "run", `./${entry}`], String(dir));
    const printed = await printedBy([join(String(dir), "compiled.exe")], String(dir));
    const differ = program.filter(cell => printed.get(cell.id) !== expected.get(cell.id));
    found.push(...differ.map(cell => cell.id));
    if (updates) return;
    expect(
      differ
        .filter(cell => !known.has(cell.id))
        .map(cell => ({
          cell: `${cell.id} | ${cell.what}`,
          expected: expected.get(cell.id),
          printed: printed.get(cell.id),
        })),
    ).toEqual([]);
    expect(
      program
        .filter(cell => known.has(cell.id) && !differ.includes(cell))
        .map(cell => `${cell.id}: it goes out of the list`),
    ).toEqual([]);
  });
});
