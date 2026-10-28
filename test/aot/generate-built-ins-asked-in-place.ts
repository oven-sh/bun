// The programs of built-ins-asked-in-place: `bun test/aot/generate.ts built-ins-asked-in-place <where>` writes them. For each row of the table of built-ins that the compiler trusts,
// a call of the built-in and questions about what it answers that stand in place (./built-ins-alone/in-place.ts). The rows of one holder share a program. A new row gets its questions by itself.
//
// For whoever works on the table:
//
//   bun test/aot/generate-built-ins-asked-in-place.ts --table <aot_builtin_table.json> --rows <file.tsv>
//
// writes one line per row of the table: the row, the programs that ask about it, or why none does. ONLY_ROWS=<regular expression> takes only the rows whose path matches.
import { existsSync, writeFileSync } from "fs";
import { inPlacePrograms, rowsByHolder, rowsNotAsked } from "./built-ins-alone/in-place";
import { asWritten } from "./built-ins-alone/program";
import { describedRows, readTable, type Row } from "./built-ins-alone/table";
import type { WrittenProgram } from "./generate";

export const programs = (): WrittenProgram[] => [];

export const fromTable = {
  extension: "mjs",
  groups: rowsByHolder,
  async programs(groups: Map<string, Row[]>): Promise<Map<string, WrittenProgram[]>> {
    return new Map(Array.from(await inPlacePrograms(groups), ([group, made]) => [group, made.map(asWritten)]));
  },
};

if (import.meta.main) {
  const option = (name: string): string | null => {
    const index = process.argv.indexOf(name);
    return index === -1 ? null : (process.argv[index + 1] ?? null);
  };
  const tablePath = option("--table");
  const rowsPath = option("--rows");
  if (tablePath === null || !existsSync(tablePath) || rowsPath === null) {
    console.error("bun test/aot/generate-built-ins-asked-in-place.ts --table <aot_builtin_table.json> --rows <file.tsv>");
    process.exit(1);
  }
  process.on("unhandledRejection", () => {});
  process.on("uncaughtException", () => {});
  const rows = describedRows(readTable(tablePath));
  const made = [...(await inPlacePrograms(rowsByHolder(rows))).values()].flat();
  const programsOfRow = new Map<string, string[]>();
  for (const program of made) for (const row of program.rows) programsOfRow.set(row, [...(programsOfRow.get(row) ?? []), program.name]);
  console.log(`${made.length} programs; ${rows.filter(row => programsOfRow.has(row.path)).length} of ${rows.length} rows that the compiler trusts are asked about`);
  writeFileSync(rowsPath, rows.map(row => [row.path, row.origin, (programsOfRow.get(row.path) ?? []).join(" "), rowsNotAsked.get(row.path) ?? ""].join("\t")).join("\n") + "\n");
  process.exit(0);
}
