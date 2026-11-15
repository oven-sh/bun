import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll } from "../../harness/default-timeout";
import { cellsOf, programOf, ways, type Way } from "../../harness/deferred-graphs";
import { countingIn, expectHeldGraphsLetGo } from "../../harness/held-graphs";
import { run } from "../../harness/run";
import { describe, test } from "../../supported";

// deferred-graphs.known.txt: the cells on which an executable does not print today what `bun run` prints. A line goes out when its cell is
// right again, and none may come in. AOT_DEFERRED_GRAPHS_UPDATE=1 writes what a run finds.
// In front of a merge one cell in twenty runs, another part each day, the first four of the list, and four cells that were once on it: an import() that
// never settled, a file that ran inside the read of a deferred namespace, an import() that was rejected, and one rejected with another error. On a bench, and where the list is written, all.
const updates = !!process.env.AOT_DEFERRED_GRAPHS_UPDATE;
const list = join(import.meta.dir, "..", "..", "deferred-graphs.known.txt");
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

// `bun run` alone runs a module that an `import()` under a require() names INSIDE the require(): its loader drains the steps of the call before it returns.
// node, `bun build --compile` and an executable run it behind, in jobs, as ECMA-262 has it (`c< c> a< a> b< b> + cb+` | `c< c> a< a> + b< b> cb+`, with or without `import defer`).
// Nothing else runs these graphs, so such a cell is held to the line of `bun run` in parts: the modules run in the same order and see the same,
// the require() ends the same way, and each call settles the same way. Which of two calls settles first goes by the jobs between them, and is not held.
const wordsOf = (line: string | undefined) => (line ?? "").replace(/ (late )?threw /g, " $1threw_").split(" ").slice(2);
const isEndOfRequire = (word: string) => word === "+" || word.startsWith("threw_");
const isEndOfCall = (word: string) => /^[abc][abc][+!]/.test(word);
function ranInsideRequire(words: string[]) {
  const end = words.findIndex(isEndOfRequire);
  return new Set(words.slice(0, end < 0 ? words.length : end).filter(word => word.endsWith("<")));
}
function agree(printed: string | undefined, expected: string | undefined) {
  if (printed === expected) return true;
  const [ours, plain] = [wordsOf(printed), wordsOf(expected)];
  const [inOurs, inPlain] = [ranInsideRequire(ours), ranInsideRequire(plain)];
  if (inPlain.size <= inOurs.size || !inOurs.isSubsetOf(inPlain)) return false;
  const partsOf = (words: string[]) => [
    words.filter(word => !isEndOfRequire(word) && !isEndOfCall(word)),
    words.filter(isEndOfRequire),
    words.filter(isEndOfCall).sort(),
  ];
  return Bun.deepEquals(partsOf(ours), partsOf(plain));
}

async function printedBy(command: string[], dir: string, env?: Record<string, string | undefined>) {
  const { stdout, stderr, exitCode } = await run(command, dir, env);
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return linesOf(stdout);
}

describe.concurrent.each(Object.keys(ways) as Way[])("graphs with import defer: %s", way => {
  const cells = cellsOf(way);
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
    const printed = await printedBy([join(String(dir), "compiled.exe")], String(dir), countingIn(String(dir)));
    expectHeldGraphsLetGo(String(dir));
    const differ = program.filter(cell => !agree(printed.get(cell.id), expected.get(cell.id)));
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
