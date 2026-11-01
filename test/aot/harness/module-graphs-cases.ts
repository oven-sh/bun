import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "../supported";
import { afterAll } from "./default-timeout";
import { cellsOf, programInEntryBody, programOf, tables, type Cell, type Table } from "./module-graphs";
import { run } from "./run";
import { partOfGrid, runsWholeGrids } from "./ways";

// module-graphs.expected.txt        what node, `bun run` and `bun build --compile` all print. A cell on which they differ is not in it.
//                                   For `continuations`, on which `bun run` does not print the same every time: what node,
//                                   `bun build --compile` and `bun run` under BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1 all print.
// module-graphs.known.txt           the cells on which an executable prints something else today
// module-graphs.plain-differs.txt   the cells on which plain `bun test` prints something else, or not the same every time
// module-graphs.known-in-tests.txt  `<cell> <form>`: the cells on which `bun test --aot` prints something else today
// module-graphs.parted.txt          `<cell> <form>`: the cells on which `bun test --aot` does not print what the executable prints
// module-graphs.body-expected.txt   as the first, where a CommonJS entry point begins all cells in its own body
// module-graphs.body-known.txt      as the second, for those
// A line of a list of what is not right goes out when its cell is right again, and none may come in, but for one kind: where a test run
// comes to print what the executable prints, and that is not the stored line, its line goes out of the last list and into the last but one.
// What stands behind ` # ` on a line is a remark. AOT_MODULE_GRAPHS_UPDATE=1 writes `# as the executable: <what>` behind such a line:
//   calls some jobs apart            `const first = import("./a"); await null; await Promise.all([first, import("./b")])`, or three calls at once
//   a CommonJS file as the root      `import("./b.cjs")` beside another call
//   a cycle entered by a later call  an error is printed where the stored line has none: a name is read before its module has run
//   the order of calls in one job    the modules run, or the calls settle, in another order
//
// The tables are tools for finding faults. In front of a merge one stored cell in twenty runs, another part each day, and of each table the
// first two cells of each list, so that a list still rings when what it lists is cured; all of them in one program for each kind of entry
// point. On a bench (AOT_WHOLE_GRIDS=1), and where the lists are written, every cell runs, a thousand to a program.
// AOT_MODULE_GRAPHS_UPDATE=1 writes what a run finds into them, for the tables of the file that is run.
const updates = !!process.env.AOT_MODULE_GRAPHS_UPDATE;
const whole = runsWholeGrids || updates;
const pathOf = (name: string) => join(import.meta.dir, "..", name);
const withRemarks = (name: string): string[] => readFileSync(pathOf(name), "utf8").split(/\r?\n/).filter(Boolean);
const withoutRemark = (line: string) => line.replace(/ # .*$/, "");
const linesOf = (name: string): string[] => withRemarks(name).map(withoutRemark);
const cellOf = (line: string) => line.slice(0, line.indexOf(" "));
const printedBy = (stdout: string) =>
  new Map(
    stdout
      .split(/\r?\n/)
      .filter(line => line.includes(" :"))
      .map(line => [cellOf(line), line]),
  );
const expected = new Map(linesOf("module-graphs.expected.txt").map(line => [cellOf(line), line]));

/** A table, and how many turns of the job queue lie between the calls. */
type Kind = readonly [table: Table, turns: number];
export const everyKind: Kind[] = [
  ...tables.map(table => [table, 0] as const),
  ...[1, 2, 3, 4, 6].flatMap(turns => (["two", "three", "commonjs"] as const).map(table => [table, turns] as const)),
  ...[1, 2, 3].map(turns => ["three-calls", turns] as const),
];

const inThousands = (table: Table, cells: Cell[]) =>
  Array.from({ length: Math.ceil(cells.length / 1000) }, (_, i) => cells.slice(i * 1000, i * 1000 + 1000)).map(
    program => [`${table}, from ${program[0].id} on`, table, program] as const,
  );

/** `lists`: the lists of what is not right that the programs are held against. */
function programsOf(grid: string, kinds: Kind[], stored: Map<string, string>, lists: string[]) {
  const storedOf = ([table, turns]: Kind) => cellsOf(table, turns).filter(cell => stored.has(cell.id));
  if (whole) return kinds.flatMap(kind => inThousands(kind[0], storedOf(kind)));
  const listed = lists.map(name => new Set(linesOf(name).map(line => line.split(" ")[0])));
  const all = kinds.flatMap(kind => {
    const cells = storedOf(kind);
    const witnesses = new Set(listed.flatMap(list => cells.filter(cell => list.has(cell.id)).slice(0, 2)));
    return cells.map(cell => ({ cell, isCommonJS: kind[0] === "commonjs", isWitness: witnesses.has(cell) }));
  });
  const part = new Set(partOfGrid(grid, all, 20, it => it.cell.id));
  const taken = all.filter(it => it.isWitness || part.has(it));
  return [
    ...inThousands(
      "two",
      taken.filter(it => !it.isCommonJS).map(it => it.cell),
    ),
    ...inThousands(
      "commonjs",
      taken.filter(it => it.isCommonJS).map(it => it.cell),
    ),
  ];
}

/** A list of what is not right yet. What a run finds is held against it, line by line. */
function listOf(name: string, kinds: Kind[]) {
  const written = withRemarks(name);
  const listed = new Set(written.map(withoutRemark));
  const found: string[] = [];
  const letters = (line: string) => line.replace(/^([a-z]+)\d+(k\d+)?.*$/, "$1$2");
  const number = (line: string) => Number(line.match(/\d+/)![0]);
  if (updates)
    afterAll(() => {
      const mine = new Set(kinds.map(([table, turns]) => letters(cellsOf(table, turns)[0].id)));
      const lines = [...written.filter(line => !mine.has(letters(line))), ...found];
      lines.sort((a, b) => letters(a).localeCompare(letters(b)) || number(a) - number(b) || a.localeCompare(b));
      writeFileSync(pathOf(name), lines.map(line => line + "\n").join(""));
    });
  return {
    /**
     * `lines`: all that this run could have found. `differ`: what it found, with what is shown where a line is new.
     * `remarks`: what is written behind some of those lines.
     */
    hold(lines: string[], differ: Map<string, unknown>, remarks = new Map<string, string>()) {
      found.push(...[...differ.keys()].map(line => (remarks.has(line) ? `${line} # ${remarks.get(line)}` : line)));
      if (updates) return;
      expect([...differ].filter(([line]) => !listed.has(line)).map(([, shown]) => shown)).toEqual([]);
      expect(
        lines.filter(line => listed.has(line) && !differ.has(line)).map(line => `${line}: it goes out of ${name}`),
      ).toEqual([]);
    },
  };
}

async function executableOf(dir: string, entry: string) {
  const built = await run([bunExe(), "build", "--compile", "--aot", `./${entry}`, "--outfile", "compiled.exe"], dir);
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const { stdout, stderr, exitCode } = await run([join(dir, "compiled.exe")], dir);
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return printedBy(stdout);
}

const shown = (cell: Cell, wanted: string | undefined, printed: string | undefined) => ({
  cell: `${cell.id} | ${cell.what}`,
  expected: wanted,
  printed,
});

export function testGraphs(kinds = everyKind) {
  const known = listOf("module-graphs.known.txt", kinds);

  describe.concurrent("graphs of modules", () => {
    test.each(programsOf("graphs of modules", kinds, expected, ["module-graphs.known.txt"]))(
      "%s",
      async (_, table, program) => {
        const { entry, files } = programOf(table, program);
        using dir = tempDir("aot-module-graphs", files);
        const printed = await executableOf(String(dir), entry);
        known.hold(
          program.map(cell => cell.id),
          new Map(
            program
              .filter(cell => printed.get(cell.id) !== expected.get(cell.id))
              .map(cell => [cell.id, shown(cell, expected.get(cell.id), printed.get(cell.id))]),
          ),
        );
      },
    );
  });
}

/** The same cells, all begun in the body of a CommonJS entry point. */
export function testGraphsInEntryBody() {
  const kinds = tables.map(table => [table, 0] as const);
  const stored = new Map(linesOf("module-graphs.body-expected.txt").map(line => [cellOf(line), line]));
  const known = listOf("module-graphs.body-known.txt", kinds);
  const grid = "graphs of modules, begun in the body of a CommonJS entry point";

  describe.concurrent(grid, () => {
    test.each(programsOf(grid, kinds, stored, ["module-graphs.body-known.txt"]))("%s", async (_, table, program) => {
      const { entry, files } = programInEntryBody(table, program);
      using dir = tempDir("aot-module-graphs", files);
      const printed = await executableOf(String(dir), entry);
      known.hold(
        program.map(cell => cell.id),
        new Map(
          program
            .filter(cell => printed.get(cell.id) !== stored.get(cell.id))
            .map(cell => [cell.id, shown(cell, stored.get(cell.id), printed.get(cell.id))]),
        ),
      );
    });
  });
}

/** What a cell that the executable gets wrong is about. */
const whatOf = (cell: Cell, printed: string | undefined) =>
  /k\d+$/.test(cell.id) || cell.id.startsWith("tc")
    ? "calls some jobs apart"
    : cell.id.startsWith("x")
      ? "a CommonJS file as the root"
      : /Error/.test(printed ?? "") && !/Error/.test(expected.get(cell.id) ?? "")
        ? "a cycle entered by a later call"
        : "the order of calls in one job";

const forms = [
  ["one", "TestRunLayers:0"],
  ["layers", "TestRunLayers:2"],
] as const;

/** The same cells inside one test of a test file, as one program and in layers, beside the executable. */
export function testGraphsInTestRuns(kinds = everyKind) {
  const plainDiffers = new Set(linesOf("module-graphs.plain-differs.txt"));
  const known = listOf("module-graphs.known-in-tests.txt", kinds);
  const parted = listOf("module-graphs.parted.txt", kinds);
  // That a test run prints what the executable prints says that the two agree, not that either is right: three numbers, never the last alone.
  const counts = { cells: 0, executable: 0, one: { wrong: 0, apart: 0 }, layers: { wrong: 0, apart: 0 } };
  afterAll(() => {
    console.log(`of ${counts.cells} cells the executable does not print the stored line on ${counts.executable}`);
    for (const [form] of forms)
      console.log(
        `bun test --aot, ${form}: it does not print the stored line on ${counts[form].wrong}, and not what the executable prints on ${counts[form].apart}`,
      );
  });

  const grid = "graphs of modules in a test run";
  describe.concurrent(grid, () => {
    test.each(
      programsOf(grid, kinds, expected, [
        "module-graphs.known.txt",
        "module-graphs.known-in-tests.txt",
        "module-graphs.parted.txt",
      ]),
    )("%s", async (_, table, program) => {
      const { entry, testFile, files } = programOf(table, program);
      using dir = tempDir("aot-module-graphs-in-tests", files);
      const executable = await executableOf(String(dir), entry);
      counts.cells += program.length;
      counts.executable += program.filter(cell => executable.get(cell.id) !== expected.get(cell.id)).length;
      for (const [form, words] of forms) {
        const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot", `./${testFile}`], String(dir), {
          ...bunEnv,
          BUN_DEBUG_TEST_AOT_WORDS: words,
        });
        expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
        if (form === "layers" && stderr.includes("this Bun loads one program a realm")) continue;
        expect(stderr.match(/^AOT test run \| .*\| refused [1-9].*$/m)?.[0]).toBeUndefined();
        const printed = printedBy(stdout);
        counts[form].wrong += program.filter(cell => printed.get(cell.id) !== expected.get(cell.id)).length;
        const held = program.filter(cell => !plainDiffers.has(cell.id));
        const wrong = held.filter(cell => printed.get(cell.id) !== expected.get(cell.id));
        known.hold(
          held.map(cell => `${cell.id} ${form}`),
          new Map(wrong.map(cell => [`${cell.id} ${form}`, shown(cell, expected.get(cell.id), printed.get(cell.id))])),
          new Map(
            wrong
              .filter(cell => printed.get(cell.id) === executable.get(cell.id))
              .map(cell => [`${cell.id} ${form}`, `as the executable: ${whatOf(cell, printed.get(cell.id))}`]),
          ),
        );
        const apart = program.filter(cell => printed.get(cell.id) !== executable.get(cell.id));
        counts[form].apart += apart.length;
        parted.hold(
          program.map(cell => `${cell.id} ${form}`),
          new Map(
            apart.map(cell => [`${cell.id} ${form}`, shown(cell, executable.get(cell.id), printed.get(cell.id))]),
          ),
        );
      }
    });
  });
}
