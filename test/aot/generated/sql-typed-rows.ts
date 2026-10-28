// One program for each column kind that the row decoder of sql<Row[]> knows. Each declares the column as many field types, required and optional,
// and prints every row: it reads as in plain Bun whether it was decoded into a typed object, converted in place or left a plain object.
// One program for each of three widths of a table: the row decoder keeps the values of up to 64 columns on the stack and those of a wider row in a rooted buffer.
// The stand-in Postgres is the one of ../programs/data-from-outside/sql-typed-rows.ts.
import { readFileSync } from "fs";
import { join } from "path";

const values: Record<string, string[]> = {
  int4: ["0", "1", "2", "-1", "2147483647", "-2147483648", "-1073741825", "null"],
  float4: ["0", "-0", "0.5", "NaN", "Infinity", "3", "null"],
  float8: ["0", "-0", "1", "1.5", "NaN", "-Infinity", "4294967296", "1e300", "null"],
  bool: ["true", "false", "null"],
  text: ['""', '"a"', '"b"', '"abc"', '"\\u00e9"', '"\\u65e5\\u672c"', '"1"', "null"],
  varchar: ['"a"', '"c"', "null"],
  int8: ['"1"', '"9007199254740993"', "null"],
  timestamptz: ["0n", "1n", "-1n", "1000n", "-62135596800000000n", "null"],
};

const fieldTypes = [
  "number",
  "number | null",
  "number | undefined",
  "number | null | undefined",
  "number | string",
  "number | boolean | null",
  "0 | 1 | 2",
  "0 | 1 | null",
  "1.5 | 2",
  "string",
  "string | null",
  "string | undefined",
  '"a" | "b"',
  '"a" | "b" | null',
  '"a"',
  '"" | "abc"',
  '"a" | 1',
  "string | Date",
  "boolean",
  "boolean | null",
  "boolean | undefined",
  "true",
  "false | null",
  "Date",
  "Date | null",
  "Date | undefined",
  "Date | number",
  "unknown",
  "any",
  "object",
  "object | null",
  "{}",
  "null",
  "undefined",
  "number[]",
  "bigint",
];

export const columnKinds = Object.keys(values);

function firstLines() {
  const source = readFileSync(join(import.meta.dir, "..", "programs", "data-from-outside", "sql-typed-rows.ts"), "utf8");
  return [
    source.slice(source.indexOf('import { SQL } from "bun";'), source.indexOf("interface Comment {")),
    `function show(what: string, rows: unknown[]): void {
  const describe = (value: unknown) => (Object.is(value, -0) ? "-0" : value instanceof Date ? "D" + value.getTime() : typeof value + String(value));
  console.log(what, rows.map(row => Object.keys(row as object).join() + JSON.stringify(row) + Object.values(row as object).map(describe).join("|")).join(" "));
}`,
  ];
}

function finish(lines: string[]) {
  lines.push("await sql.close();\nserver.stop(true);");
  const compilerOptions = { target: "esnext", module: "preserve", moduleResolution: "bundler", typeRoots: [join(import.meta.dir, "..", "..", "..", "packages")], types: ["bun-types"], noEmit: true };
  return { file: "main.ts", text: lines.join("\n") + "\n", files: { "tsconfig.json": JSON.stringify({ compilerOptions }) } };
}

export function program(kind: string) {
  const lines = firstLines();
  const rows = values[kind].map((value, index) => `[${index + 1}, ${value}, "z"]`).join(", ");
  lines.push(`tables.set("${kind}", { columns: [["before", "int4"], ["value", "${kind}"], ["after", "text"]], rows: [${rows}] });`);
  let count = 0;
  for (const fieldType of fieldTypes) {
    for (const optional of ["", "?"]) {
      const row = `Row${++count}`;
      lines.push(`interface ${row} {
  before: number;
  value${optional}: ${fieldType};
  after: string;
}
await sql<${row}[]>\`SELECT ${kind}\`;
{
  const rows = await sql<${row}[]>\`SELECT ${kind}\`;
  show(${JSON.stringify(`value${optional}: ${fieldType}`)}, rows);
  console.log(rows.map(row => \`\${row.before}\${typeof row.value}\${row.after}\`).join());
}`);
    }
  }
  return finish(lines);
}

const wideColumns: { kind: string; fieldType: string; cell: (row: number, column: number) => string }[] = [
  { kind: "int4", fieldType: "number", cell: (row, column) => String(row * 100 + column) },
  { kind: "text", fieldType: "string", cell: (row, column) => JSON.stringify(`row ${row}, column ${column}`) },
  { kind: "timestamptz", fieldType: "Date", cell: (row, column) => `${row * 1_000_000 + column * 1000}n` },
  { kind: "float8", fieldType: "number", cell: (row, column) => String(row + column / 4) },
  { kind: "bool", fieldType: "boolean", cell: (row, column) => String((row + column) % 2 === 0) },
];
const wideRowCount = 12;

export const wideColumnCounts = [64, 65, 130];

export function wideProgram(columnCount: number) {
  const lines = firstLines();
  const columns = Array.from({ length: columnCount }, (_, column) => ({ name: `c${column}`, ...wideColumns[column % wideColumns.length]! }));
  const createRows = (lastCell: (row: number) => string) =>
    Array.from({ length: wideRowCount }, (_, row) => `[${columns.map(({ cell }, column) => (column === columnCount - 1 ? lastCell(row) : cell(row, column))).join(", ")}]`).join(", ");
  const described = columns.map(({ name, kind }) => `["${name}", "${kind}"]`).join(", ");
  const last = columns.at(-1)!;
  lines.push(`tables.set("matching", { columns: [${described}], rows: [${createRows(row => last.cell(row, columnCount - 1))}] });`);
  lines.push(`tables.set("mismatching", { columns: [${described}], rows: [${createRows(row => (row % 2 ? "null" : last.cell(row, columnCount - 1)))}] });`);
  lines.push(`interface Row {\n${columns.map(({ name, fieldType }) => `  ${name}: ${fieldType};`).join("\n")}\n}`);
  for (const [table, lastRead] of [
    ["matching", ` \${row.${last.name}}`],
    ["mismatching", ""],
  ]) {
    lines.push(`await sql<Row[]>\`SELECT ${table}\`;
{
  const rows = await sql<Row[]>\`SELECT ${table}\`;
  show("${table}", rows);
  console.log(rows.map(row => \`\${row.c0} \${row.c1} \${row.c2.getTime()} \${row.c3} \${row.c4}${lastRead}\`).join());
}`);
  }
  return finish(lines);
}
