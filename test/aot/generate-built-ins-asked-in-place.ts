import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { inPlacePrograms, rowsNotAsked } from "./built-ins-alone/in-place";
import { describedRows, readTable } from "./built-ins-alone/table";

const usage = `bun test/aot/generate-built-ins-asked-in-place.ts --table <aot_builtin_table.json> [--folder <folder>] [--rows <file.tsv>]

Writes test/aot/programs/built-ins-asked-in-place/, or the folder given: for each row of the table of built-ins that the compiler trusts, a call of
the built-in and questions about what it answers that stand in place (built-ins-alone/in-place.ts). The rows of one holder share a program.
Every file of that folder is written by this script: what it does not write again is removed. A new row gets its questions by running it again.
ONLY_ROWS=<regular expression> takes only the rows whose path matches, and removes nothing. The table is the file of that name in the codegen folder of a build.
--rows writes one line per row of the table: the row, the programs that ask about it, or why none does.`;

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

const tablePath = option("--table");
if (tablePath === null || !existsSync(tablePath)) {
  console.error(usage);
  process.exit(1);
}

const ignore = () => {};
process.on("unhandledRejection", ignore);
process.on("uncaughtException", ignore);
const table = readTable(tablePath);
const programs = await inPlacePrograms(table);
process.off("unhandledRejection", ignore);
process.off("uncaughtException", ignore);

const folder = option("--folder") ?? join(import.meta.dir, "programs", "built-ins-asked-in-place");
mkdirSync(folder, { recursive: true });
const written = new Set<string>();
for (const program of programs) {
  const file = `${program.name}.${program.extension ?? "js"}`;
  if (written.has(file)) throw new Error(`two programs are named ${file}`);
  written.add(file);
  const path = join(folder, file);
  if (!existsSync(path) || readFileSync(path, "utf8") !== `${program.text}\n`) writeFileSync(path, `${program.text}\n`);
}
if (process.env.ONLY_ROWS === undefined) for (const file of readdirSync(folder)) if (!written.has(file)) rmSync(join(folder, file));

// Each block was tried by itself, inside this process. A program has to run as a whole, in a process of its own, twice with the same output.
for (const file of [...written].sort()) {
  const runs = [0, 1].map(() => Bun.spawnSync({ cmd: [process.execPath, "run", join(folder, file)], cwd: folder, stdout: "pipe", stderr: "pipe", timeout: 30_000 }));
  if (runs.some(run => run.exitCode !== 0) || runs[0].stdout.toString() !== runs[1].stdout.toString())
    console.log(`NOT FIT: ${file}: exit codes ${runs.map(run => run.exitCode ?? run.signalCode).join(", ")}${runs[0].stdout.toString() === runs[1].stdout.toString() ? "" : ", two outputs"}: ${runs[0].stderr.toString().split("\n").filter(line => /error/i.test(line))[0] ?? ""}`);
}

const rows = describedRows(table);
const programsOfRow = new Map<string, string[]>();
for (const program of programs) for (const row of program.rows) programsOfRow.set(row, [...(programsOfRow.get(row) ?? []), program.name]);
console.log(`${programs.length} programs; ${rows.filter(row => programsOfRow.has(row.path)).length} of ${rows.length} rows that the compiler trusts are asked about`);
const rowsPath = option("--rows");
if (rowsPath !== null) writeFileSync(rowsPath, rows.map(row => [row.path, row.origin, (programsOfRow.get(row.path) ?? []).join(" "), rowsNotAsked.get(row.path) ?? ""].join("\t")).join("\n") + "\n");
process.exit(0);
