import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { auditTable, doubts } from "./built-ins-alone/audit";
import { callbackPrograms } from "./built-ins-alone/callbacks";
import { forwardingPrograms } from "./built-ins-alone/forwarding";
import { hookPrograms } from "./built-ins-alone/hooks";
import { hostPrograms } from "./built-ins-alone/host";
import { instancePrograms } from "./built-ins-alone/instances";
import { nodePrograms } from "./built-ins-alone/node";
import type { Program } from "./built-ins-alone/program";
import { resultPrograms } from "./built-ins-alone/results";
import { routePrograms } from "./built-ins-alone/routes";
import { storePrograms } from "./built-ins-alone/stores";
import { tablePrograms, withoutProgram } from "./built-ins-alone/table-driven";
import { describedRows, readTable } from "./built-ins-alone/table";

const programsInOneTestFile = 150;
const usage = `bun test/aot/generate-built-ins-alone.ts --table <aot_builtin_table.json> [--rows <file.tsv>] [--folder <folder>] [--doubts <file.tsv>]

Writes test/aot/programs/built-ins-alone/, or the folder given. test/aot/built-ins-alone/written.txt lists the files it wrote;
a file of that folder which the list does not name was written by hand and is left alone.
Writes test/aot/built-ins-alone-<n>.test.ts too, one for each 150 programs.
ONLY_ROWS=<regular expression> takes only the rows whose path matches. PROGRAMS_OF_ONE_KIND=<n> writes at most n programs
of one kind for one overload of a row (2 unless given). ONLY_DOUBTS=1 writes no program for a row and only compares it. The table is the file of that name in the codegen folder of a build.
--doubts writes one line for each thing that a built-in did while the programs were written and that its row does not say.
--rows writes one line per row of the table: the row, how many programs name it, and their names.`;

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

const tablePath = option("--table");
const rowsPath = option("--rows");
const folderPath = option("--folder");
const doubtsPath = option("--doubts");
if (tablePath === null || !existsSync(tablePath)) {
  console.error(usage);
  process.exit(1);
}

const ignore = () => {};
process.on("unhandledRejection", ignore);
process.on("uncaughtException", ignore);

const table = readTable(tablePath);
const programs: Program[] = [
  ...forwardingPrograms(),
  ...hookPrograms(),
  ...resultPrograms(),
  ...storePrograms(),
  ...callbackPrograms(),
  ...hostPrograms(),
  ...nodePrograms(),
  ...routePrograms(),
  ...instancePrograms(),
  ...(await tablePrograms(table).catch(error => {
    console.error(error);
    process.exit(1);
  })),
];
process.off("unhandledRejection", ignore);
process.off("uncaughtException", ignore);

const folder = folderPath ?? join(import.meta.dir, "programs", "built-ins-alone");
mkdirSync(folder, { recursive: true });
const written = new Set<string>();
for (const program of programs) {
  const file = `${program.name}.${program.extension ?? "js"}`;
  if (written.has(file)) throw new Error(`two programs are named ${file}`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(program.name))
    throw new Error(`${program.name} is not a file name in plain words`);
  written.add(file);
  const path = join(folder, file);
  const text = program.text.endsWith("\n") ? program.text : `${program.text}\n`;
  if (!existsSync(path) || readFileSync(path, "utf8") !== text) writeFileSync(path, text);
}
const listPath = join(import.meta.dir, "built-ins-alone", "written.txt");
if (folderPath === null) {
  const before = existsSync(listPath) ? readFileSync(listPath, "utf8").split("\n") : [];
  for (const file of before) {
    if (file !== "" && !written.has(file)) rmSync(join(folder, file), { force: true });
  }
  writeFileSync(listPath, `${[...written].sort().join("\n")}\n`);
  const parts = Math.ceil(written.size / programsInOneTestFile);
  for (let part = 1; part <= parts; part++) {
    writeFileSync(
      join(import.meta.dir, `built-ins-alone-${part}.test.ts`),
      `import { programs } from "./run-programs";\n\nprograms("built-ins-alone", ${part}, ${parts});\n`,
    );
  }
  for (let part = parts + 1; existsSync(join(import.meta.dir, `built-ins-alone-${part}.test.ts`)); part++) {
    rmSync(join(import.meta.dir, `built-ins-alone-${part}.test.ts`));
  }
}

const programsOfRow = new Map<string, string[]>();
for (const program of programs) {
  for (const row of program.rows) {
    const list = programsOfRow.get(row) ?? [];
    list.push(program.name);
    programsOfRow.set(row, list);
  }
}
const rows = describedRows(table);
const known = new Set(rows.map(row => row.path));
const unknown = [...programsOfRow.keys()].filter(row => !known.has(row)).sort();
const covered = rows.filter(row => programsOfRow.has(row.path));
console.log(`${programs.length} programs; ${covered.length} of ${rows.length} rows that the compiler trusts have one`);
if (unknown.length > 0) console.log(`named by a program and not such a row: ${unknown.join(" ")}`);

if (rowsPath !== null) {
  const lines = rows.map(row => {
    const names = programsOfRow.get(row.path) ?? [];
    const why = names.length > 0 ? "" : (withoutProgram.get(row.path) ?? "");
    return [row.path, row.origin, row.overloads, names.length, why, names.join(" ")].join("\t");
  });
  writeFileSync(rowsPath, `${lines.join("\n")}\n`);
}
if (doubtsPath !== null) {
  auditTable(table);
  writeFileSync(
    doubtsPath,
    doubts.map(each => [each.overload, each.kind, each.text, each.call].join("\t")).join("\n") + "\n",
  );
}
process.exit(0);
