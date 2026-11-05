// sql<Row[]>`..` stores int4, float4, float8 and bool columns in a typed row without boxing them, in every slot form that a number or boolean field of a row has, in the cell and outside it. A value that its field does not accept gives a plain object.
import { SQL } from "bun";
import type { int32 } from "bun";

const OID = { bool: 16, int4: 23, text: 25, float4: 700, float8: 701 } as const;
type Kind = keyof typeof OID;
type Cell = null | boolean | number | string;
interface Table {
  columns: [name: string, kind: Kind][];
  rows: Cell[][];
}

function bytesOf(kind: Kind, cell: Cell, asBytes: boolean): Buffer | null {
  if (cell === null) return null;
  if (!asBytes) return Buffer.from(kind === "bool" ? (cell ? "t" : "f") : String(cell));
  const bytes = Buffer.alloc(kind === "bool" ? 1 : kind === "float8" ? 8 : 4);
  if (kind === "bool") bytes[0] = cell ? 1 : 0;
  else if (kind === "int4") bytes.writeInt32BE(Number(cell));
  else if (kind === "float4") bytes.writeFloatBE(Number(cell));
  else bytes.writeDoubleBE(Number(cell));
  return bytes;
}

function message(type: string, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(5);
  head.write(type, 0, "latin1");
  head.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([head, body]);
}
const int16 = (value: number) => {
  const bytes = Buffer.alloc(2);
  bytes.writeInt16BE(value);
  return bytes;
};
const int32Bytes = (value: number) => {
  const bytes = Buffer.alloc(4);
  bytes.writeInt32BE(value);
  return bytes;
};
const text = (value: string) => Buffer.concat([Buffer.from(value), Buffer.from([0])]);

const tables = new Map<string, Table>();
const tableOfStatement = new Map<string, Table>();

function answer(type: string, body: Buffer, state: { table: Table | null; formats: number[] }): Buffer {
  if (type === "P") {
    const endOfName = body.indexOf(0);
    const query = body.toString("utf8", endOfName + 1, body.indexOf(0, endOfName + 1));
    tableOfStatement.set(body.toString("utf8", 0, endOfName), tables.get(query.trim().split(" ")[1]!)!);
    return message("1");
  }
  if (type === "D") {
    const table = tableOfStatement.get(body.toString("utf8", 1, body.indexOf(0, 1)))!;
    const described = table.columns.map(([name, kind]) => Buffer.concat([text(name), int32Bytes(0), int16(0), int32Bytes(OID[kind]), int16(-1), int32Bytes(-1), int16(0)]));
    return Buffer.concat([message("t", int16(0)), message("T", int16(table.columns.length), ...described)]);
  }
  if (type === "B") {
    let at = body.indexOf(0) + 1;
    const endOfStatement = body.indexOf(0, at);
    state.table = tableOfStatement.get(body.toString("utf8", at, endOfStatement))!;
    at = endOfStatement + 1;
    at += 2 + 2 * body.readInt16BE(at);
    at += 2;
    state.formats = Array.from({ length: body.readInt16BE(at) }, (_, index) => body.readInt16BE(at + 2 + 2 * index));
    return message("2");
  }
  if (type === "E") {
    const table = state.table!;
    const rows = table.rows.map(row => {
      const cells = row.map((cell, index) => {
        const bytes = bytesOf(table.columns[index]![1], cell, state.formats[index] === 1);
        return bytes === null ? int32Bytes(-1) : Buffer.concat([int32Bytes(bytes.length), bytes]);
      });
      return message("D", int16(row.length), ...cells);
    });
    return Buffer.concat([...rows, message("C", text("SELECT " + table.rows.length))]);
  }
  return type === "S" ? message("Z", Buffer.from("I")) : Buffer.alloc(0);
}

const server = Bun.listen<{ pending: Buffer; hasStarted: boolean; table: Table | null; formats: number[] }>({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    open(socket) {
      socket.data = { pending: Buffer.alloc(0), hasStarted: false, table: null, formats: [] };
    },
    data(socket, received) {
      const state = socket.data;
      state.pending = Buffer.concat([state.pending, received]);
      const answers: Buffer[] = [];
      if (!state.hasStarted) {
        if (state.pending.length < 4 || state.pending.length < state.pending.readInt32BE(0)) return;
        state.pending = state.pending.subarray(state.pending.readInt32BE(0));
        state.hasStarted = true;
        answers.push(message("R", int32Bytes(0)), message("Z", Buffer.from("I")));
      }
      while (state.pending.length >= 5 && state.pending.length >= 1 + state.pending.readInt32BE(1)) {
        const end = 1 + state.pending.readInt32BE(1);
        answers.push(answer(String.fromCharCode(state.pending[0]!), state.pending.subarray(5, end), state));
        state.pending = state.pending.subarray(end);
      }
      socket.write(Buffer.concat(answers));
    },
  },
});

const sql = new SQL({ url: `postgres://user@127.0.0.1:${server.port}/database`, max: 1 });

// Each of two int32 fields has a four-byte slot, and the five smallest int32 values are stored outside the cell. A single int32 field has an eight-byte slot.
interface Position {
  station: int32;
  sequence: int32;
}
interface Counter {
  count: int32;
}
interface Level {
  level: number;
  code: number | string;
}
interface Flags {
  isValid: boolean;
  mark: boolean | string;
}
// Too large for all of its fields to be in the cell.
interface Sample {
  site: int32;
  run: int32;
  depth: number;
  weight: number;
  grade: number | string;
  isFinal: boolean;
  note: boolean | string;
  label: string;
  width?: number;
  height?: number;
  span?: number;
  area?: number;
  volume?: number;
  speed?: number;
  angle?: number;
  isChecked?: boolean;
}

const createTable = (names: string[], kinds: Kind[], rows: Cell[][]): Table => ({ columns: names.map((name, index): [string, Kind] => [name, kinds[index]!]), rows });
const position = ["station", "sequence"];
const level = ["level", "code"];
const flags = ["isValid", "mark"];
const sample = ["site", "run", "depth", "weight", "grade", "isFinal", "note", "label"];
const measuredSample = [...sample, "width", "height", "span", "area", "volume", "speed", "angle", "isChecked"];
tables.set("positions", createTable(position, ["int4", "int4"], [[1, 2], [2147483647, -2147483643], [-2147483644, -2147483648], [null, null]]));
tables.set("wholePositions", createTable(position, ["float8", "float8"], [[7, -2147483648], [1.5, 1]]));
tables.set("counts", createTable(["count"], ["int4"], [[0], [-2147483648], [2147483647], [null]]));
tables.set("wholeCounts", createTable(["count"], ["float8"], [[5], [4294967296]]));
tables.set("integerLevels", createTable(level, ["int4", "int4"], [[3, 4], [-2147483648, 2147483647], [null, null]]));
tables.set("doubleLevels", createTable(level, ["float8", "float8"], [[1.5, 2.5], [-0, -0], [NaN, NaN], [4294967296, 3]]));
tables.set("singleLevels", createTable(level, ["float4", "float4"], [[0.25, -0.5]]));
tables.set("textLevels", createTable(level, ["int4", "text"], [[1, "c"]]));
tables.set("booleanLevels", createTable(level, ["bool", "int4"], [[true, 1]]));
tables.set("flags", createTable(flags, ["bool", "bool"], [[true, false], [false, true], [null, null]]));
tables.set("textFlags", createTable(flags, ["bool", "text"], [[true, "m"], [false, ""]]));
tables.set("numberFlags", createTable(flags, ["int4", "bool"], [[1, true]]));
tables.set("samples", createTable(sample, ["int4", "int4", "float8", "int4", "float8", "bool", "bool", "text"], [
  [1, 2, 1.5, 3, 2.5, true, false, "first"],
  [-2147483648, 2147483647, -0, -2147483648, -0, false, true, ""],
  [null, null, null, null, null, null, null, null],
]));
tables.set("measuredSamples", createTable(measuredSample, ["int4", "int4", "int4", "float8", "text", "bool", "text", "text", "int4", "float8", "float4", "int4", "float8", "float8", "float8", "bool"], [
  [5, 6, 7, NaN, "g", true, "n", "second", 8, 4294967296, 0.25, -2147483648, -0, NaN, 1.5, true],
  [7, 8, 9, 0.5, "h", false, "o", "third", null, null, null, null, null, null, null, null],
]));
tables.set("brokenSamples", createTable(measuredSample, ["int4", "int4", "int4", "float8", "text", "bool", "text", "text", "int4", "float8", "float4", "int4", "float8", "float8", "bool", "int4"], [
  [5, 6, 7, 0.5, "g", true, "n", "fourth", 8, 9, 0.25, 1, 2, 3, true, 1],
]));

function show(what: string, rows: unknown[]): void {
  console.log(what);
  for (const row of rows) console.log(" ", Object.keys(row as object).join(), JSON.stringify(row), Bun.inspect(row, { compact: true } as any).replace(/\s+/g, " "));
}

async function twice<Row>(what: string, query: () => Promise<Row[]>, use?: (rows: Row[]) => unknown): Promise<void> {
  await query();
  const rows = await query();
  show(what, rows);
  Bun.gc(true);
  if (use) console.log("  ->", use(rows));
}

const shown = (value: unknown) => (Object.is(value, -0) ? "-0" : typeof value === "string" ? JSON.stringify(value) : String(value));
const describePositions = (rows: Position[]) => rows.map(row => `${shown(row.station)} ${shown(row.sequence)} ${row.station + row.sequence}`).join(" | ");
const describeCounters = (rows: Counter[]) => rows.map(row => `${shown(row.count)} ${row.count + 1}`).join(" | ");
const describeLevels = (rows: Level[]) => rows.map(row => `${shown(row.level)} ${row.level * 2} ${shown(row.code)} ${typeof row.code}`).join(" | ");
const describeFlags = (rows: Flags[]) => rows.map(row => `${shown(row.isValid)} ${!row.isValid} ${shown(row.mark)} ${row.mark === true}`).join(" | ");
const describeSamples = (rows: Sample[]) =>
  rows
    .map(row => {
      const measures = [row.width, row.height, row.span, row.area, row.volume, row.speed, row.angle, row.isChecked].map(shown).join();
      return `${row.site + row.run} ${shown(row.depth)} ${row.weight * 2} ${shown(row.grade)} ${!row.isFinal} ${shown(row.note)} ${shown(row.label)} ${measures} ${"width" in row} ${(row.area ?? 1) + (row.angle ?? 1)}`;
    })
    .join(" | ");

await twice("int4 in two int32 fields", () => sql<Position[]>`SELECT positions`, describePositions);
await twice("float8 in two int32 fields, with and without a fraction", () => sql<Position[]>`SELECT wholePositions`);
await twice("int4 in the only int32 field", () => sql<Counter[]>`SELECT counts`, describeCounters);
await twice("float8 in the only int32 field, in and past its range", () => sql<Counter[]>`SELECT wholeCounts`);
await twice("int4 in number fields", () => sql<Level[]>`SELECT integerLevels`, describeLevels);
await twice("float8 in number fields", () => sql<Level[]>`SELECT doubleLevels`, describeLevels);
await twice("float4 in number fields", () => sql<Level[]>`SELECT singleLevels`, describeLevels);
await twice("text in a field that also takes a number", () => sql<Level[]>`SELECT textLevels`, describeLevels);
await twice("bool in a number field", () => sql<Level[]>`SELECT booleanLevels`);
await twice("bool in boolean fields", () => sql<Flags[]>`SELECT flags`, describeFlags);
await twice("text in a field that also takes a boolean", () => sql<Flags[]>`SELECT textFlags`, describeFlags);
await twice("int4 in a boolean field", () => sql<Flags[]>`SELECT numberFlags`);
await twice("fields outside the cell, no optional column", () => sql<Sample[]>`SELECT samples`, describeSamples);
await twice("fields outside the cell, every optional column", () => sql<Sample[]>`SELECT measuredSamples`, describeSamples);
await twice("bool in a number field and int4 in a boolean field outside the cell", () => sql<Sample[]>`SELECT brokenSamples`);

function movePositions(rows: Position[]): string {
  for (const row of rows) {
    row.station = (row.sequence + 1) | 0;
    row.sequence = -2147483647;
  }
  return describePositions(rows) + " " + JSON.stringify(rows);
}
function changeSamples(rows: Sample[]): string {
  for (const row of rows) {
    row.run = (row.site + 1) | 0;
    row.depth += 0.5;
    row.weight *= 2;
    row.grade = typeof row.grade === "string" ? 1 : "one";
    row.isFinal = !row.isFinal;
    row.note = row.note === true ? "set" : true;
    row.label += "!";
    row.height = (row.height ?? 0) - 0.5;
    row.isChecked = !row.isChecked;
  }
  return describeSamples(rows) + " " + JSON.stringify(rows);
}
console.log(movePositions(await sql<Position[]>`SELECT positions`));
console.log(changeSamples(await sql<Sample[]>`SELECT samples`));
console.log(changeSamples(await sql<Sample[]>`SELECT measuredSamples`));

const retainedPositions: Position[] = [...(await sql<Position[]>`SELECT positions`), ...(await sql<Position[]>`SELECT wholePositions`)];
const retainedCounters: Counter[] = [...(await sql<Counter[]>`SELECT counts`), ...(await sql<Counter[]>`SELECT wholeCounts`)];
const retainedLevels: Level[] = [
  ...(await sql<Level[]>`SELECT integerLevels`),
  ...(await sql<Level[]>`SELECT doubleLevels`),
  ...(await sql<Level[]>`SELECT singleLevels`),
  ...(await sql<Level[]>`SELECT textLevels`),
  ...(await sql<Level[]>`SELECT booleanLevels`),
];
const retainedFlags: Flags[] = [...(await sql<Flags[]>`SELECT flags`), ...(await sql<Flags[]>`SELECT textFlags`), ...(await sql<Flags[]>`SELECT numberFlags`)];
const retainedSamples: Sample[] = [...(await sql<Sample[]>`SELECT samples`), ...(await sql<Sample[]>`SELECT measuredSamples`), ...(await sql<Sample[]>`SELECT brokenSamples`)];
function countRetainedRows(): string {
  return [retainedPositions.length, retainedCounters.length, retainedLevels.length, retainedFlags.length, retainedSamples.length].join();
}
// Reachable from the global object, the function keeps these rows alive until the exit, where object-census.test.ts counts them by layout.
(globalThis as any).countRetainedRows = countRetainedRows;
console.log("retained", countRetainedRows());

await sql.close();
server.stop(true);
