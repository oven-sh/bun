// The programs of built-ins-alone that are not written by hand: `bun test/aot/generate.ts built-ins-alone <where>` writes them. Each calls one built-in in one way and prints what came of it.
// Some are listed in the files of ./built-ins-alone. The others follow from the table of built-ins: for each row that the compiler trusts, ./built-ins-alone/table-driven.ts
// calls the built-in with sample operands, looks at what it does with them, and writes programs that ask for just that.
//
// For whoever works on the table:
//
//   bun test/aot/generate-built-ins-alone.ts --table <aot_builtin_table.json> [--rows <file.tsv>] [--doubts <file.tsv>]
//
// --rows writes one line per row of the table: the row, how many programs name it, and their names.
// --doubts writes one line for each thing that a built-in did while the programs were written and that its row does not say.
// ONLY_ROWS=<regular expression> takes only the rows whose path matches. PROGRAMS_OF_ONE_KIND=<n> makes at most n programs of one kind for one overload of a row (2 unless given).
// ONLY_DOUBTS=1 makes no program for a row and only compares it. The table is the file of that name in the codegen folder of a build.
import { existsSync, writeFileSync } from "fs";
import { auditTable, doubts } from "./built-ins-alone/audit";
import { callbackPrograms } from "./built-ins-alone/callbacks";
import { forwardingPrograms } from "./built-ins-alone/forwarding";
import { hookPrograms } from "./built-ins-alone/hooks";
import { hostPrograms } from "./built-ins-alone/host";
import { instancePrograms } from "./built-ins-alone/instances";
import { nodePrograms } from "./built-ins-alone/node";
import { asWritten, type Program } from "./built-ins-alone/program";
import { resultPrograms } from "./built-ins-alone/results";
import { routePrograms } from "./built-ins-alone/routes";
import { storePrograms } from "./built-ins-alone/stores";
import { groupsOfRows, tablePrograms, withoutProgram } from "./built-ins-alone/table-driven";
import { describedRows, readTable, type Row } from "./built-ins-alone/table";
import type { WrittenProgram } from "./generate";

const listed = (): Program[] => [
  ...forwardingPrograms(),
  ...hookPrograms(),
  ...resultPrograms(),
  ...storePrograms(),
  ...callbackPrograms(),
  ...hostPrograms(),
  ...nodePrograms(),
  ...routePrograms(),
  ...instancePrograms(),
];

export const programs = (): WrittenProgram[] => listed().map(asWritten);

export const fromTable = {
  extension: "js",
  groups: groupsOfRows,
  async programs(groups: Map<string, Row[]>): Promise<Map<string, WrittenProgram[]>> {
    return new Map(Array.from(await tablePrograms(groups, null), ([group, made]) => [group, made.map(asWritten)]));
  },
};

if (import.meta.main) {
  const option = (name: string): string | null => {
    const index = process.argv.indexOf(name);
    return index === -1 ? null : (process.argv[index + 1] ?? null);
  };
  const tablePath = option("--table");
  const rowsPath = option("--rows");
  const doubtsPath = option("--doubts");
  if (tablePath === null || !existsSync(tablePath) || (rowsPath === null && doubtsPath === null)) {
    console.error("bun test/aot/generate-built-ins-alone.ts --table <aot_builtin_table.json> [--rows <file.tsv>] [--doubts <file.tsv>]");
    process.exit(1);
  }
  process.on("unhandledRejection", () => {});
  process.on("uncaughtException", () => {});
  const table = readTable(tablePath);
  const rows = describedRows(table);
  const made = [...listed(), ...[...(await tablePrograms(groupsOfRows(rows), doubtsPath === null ? null : table)).values()].flat()];

  const programsOfRow = new Map<string, string[]>();
  for (const program of made) for (const row of program.rows) programsOfRow.set(row, [...(programsOfRow.get(row) ?? []), program.name]);
  const known = new Set(rows.map(row => row.path));
  const unknown = [...programsOfRow.keys()].filter(row => !known.has(row)).sort();
  console.log(`${made.length} programs; ${rows.filter(row => programsOfRow.has(row.path)).length} of ${rows.length} rows that the compiler trusts have one`);
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
    writeFileSync(doubtsPath, doubts.map(each => [each.overload, each.kind, each.text, each.call].join("\t")).join("\n") + "\n");
  }
  process.exit(0);
}
