// sql<Row[]>`..` creates typed objects when optional columns are missing, when a number column leaves the int32 range and when the type has 64 fields. A type with 70 fields or with a method gets plain objects.
import { SQL } from "bun";

const OID = { bool: 16, int8: 20, int4: 23, text: 25, json: 114, float4: 700, float8: 701, varchar: 1043, timestamp: 1114, timestamptz: 1184, uuid: 2950, mood: 70000 } as const;
type Kind = keyof typeof OID;
type Cell = null | boolean | number | string | bigint;
interface Table {
  columns: [name: string, kind: Kind][];
  rows: Cell[][];
}

const isSentAsBytes = (kind: Kind) => kind === "bool" || kind === "int4" || kind === "float4" || kind === "float8" || kind === "timestamp" || kind === "timestamptz";

function bytesOf(kind: Kind, cell: Cell, asBytes: boolean): Buffer | null {
  if (cell === null) return null;
  if (!asBytes) {
    if (kind === "bool") return Buffer.from(cell ? "t" : "f");
    if (kind === "timestamp" || kind === "timestamptz") {
      if (cell === 9223372036854775807n) return Buffer.from("infinity");
      const text = new Date(Number(cell) / 1000 + 946684800000).toISOString().replace("T", " ").replace("Z", "");
      return Buffer.from(kind === "timestamptz" ? text + "+00" : text);
    }
    return Buffer.from(String(cell));
  }
  const bytes = Buffer.alloc(kind === "bool" ? 1 : kind === "int4" || kind === "float4" ? 4 : 8);
  if (kind === "bool") bytes[0] = cell ? 1 : 0;
  else if (kind === "int4") bytes.writeInt32BE(Number(cell));
  else if (kind === "float4") bytes.writeFloatBE(Number(cell));
  else if (kind === "float8") bytes.writeDoubleBE(Number(cell));
  else bytes.writeBigInt64BE(BigInt(cell));
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
const int32 = (value: number) => {
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
    const described = table.columns.map(([name, kind]) => Buffer.concat([text(name), int32(0), int16(0), int32(OID[kind]), int16(-1), int32(-1), int16(0)]));
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
        return bytes === null ? int32(-1) : Buffer.concat([int32(bytes.length), bytes]);
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
        answers.push(message("R", int32(0)), message("Z", Buffer.from("I")));
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

interface Sparse {
  id: number;
  note?: string;
  rank?: number;
}
interface Price {
  amount: number;
}
interface Labeled {
  id: number;
  label(): string;
}
interface Full {
  c00: number; c01: number; c02: number; c03: number; c04: number; c05: number; c06: number; c07: number; c08: number; c09: number;
  c10: number; c11: number; c12: number; c13: number; c14: number; c15: number; c16: number; c17: number; c18: number; c19: number;
  c20: number; c21: number; c22: number; c23: number; c24: number; c25: number; c26: number; c27: number; c28: number; c29: number;
  c30: number; c31: number; c32: number; c33: number; c34: number; c35: number; c36: number; c37: number; c38: number; c39: number;
  c40: number; c41: number; c42: number; c43: number; c44: number; c45: number; c46: number; c47: number; c48: number; c49: number;
  c50: number; c51: number; c52: number; c53: number; c54: number; c55: number; c56: number; c57: number; c58: number; c59: number;
  c60: number; c61: number; c62: number; c63: number;
}
interface Huge {
  f00: number; f01?: number; f02?: number; f03?: number; f04?: number; f05?: number; f06?: number; f07?: number; f08?: number; f09?: number;
  f10?: number; f11?: number; f12?: number; f13?: number; f14?: number; f15?: number; f16?: number; f17?: number; f18?: number; f19?: number;
  f20?: number; f21?: number; f22?: number; f23?: number; f24?: number; f25?: number; f26?: number; f27?: number; f28?: number; f29?: number;
  f30?: number; f31?: number; f32?: number; f33?: number; f34?: number; f35?: number; f36?: number; f37?: number; f38?: number; f39?: number;
  f40?: number; f41?: number; f42?: number; f43?: number; f44?: number; f45?: number; f46?: number; f47?: number; f48?: number; f49?: number;
  f50?: number; f51?: number; f52?: number; f53?: number; f54?: number; f55?: number; f56?: number; f57?: number; f58?: number; f59?: number;
  f60?: number; f61?: number; f62?: number; f63?: number; f64?: number; f65?: number; f66?: number; f67?: number; f68?: number; f69?: number;
}

const fullColumns = Array.from({ length: 64 }, (_, index): [string, Kind] => ["c" + String(index).padStart(2, "0"), "int4"]);
tables.set("complete", { columns: [["id", "int4"], ["note", "text"], ["rank", "int4"]], rows: [[1, "a", 10], [2, "", -3]] });
tables.set("required", { columns: [["id", "int4"]], rows: [[3], [4]] });
tables.set("ranked", { columns: [["rank", "float8"], ["id", "int4"]], rows: [[0.5, 5], [7, 6]] });
tables.set("noted", { columns: [["note", "varchar"], ["id", "int4"]], rows: [["n", 7], [null, 8]] });
tables.set("integers", { columns: [["amount", "int4"]], rows: [[1], [-2147483648], [-2147483647], [-2147483644], [-2147483643], [2147483647], [0]] });
tables.set("doubles", { columns: [["amount", "float8"]], rows: [[1.5], [2], [-0], [4294967296], [-2147483648], [-2147483645.5], [10000000000.25]] });
tables.set("singles", { columns: [["amount", "float4"]], rows: [[0.25], [3]] });
tables.set("invalid", { columns: [["amount", "float8"]], rows: [[NaN], [1]] });
tables.set("full", { columns: fullColumns, rows: [fullColumns.map((_, index) => index), fullColumns.map((_, index) => -2147483648 + index)] });
tables.set("huge", { columns: [["f00", "int4"], ["f69", "int4"]], rows: [[1, 2]] });
tables.set("labeled", { columns: [["id", "int4"]], rows: [[1]] });

function show(what: string, rows: unknown[]): void {
  console.log(what);
  for (const row of rows) console.log(" ", Object.keys(row as object).join(), JSON.stringify(row), Bun.inspect(row, { compact: true } as any).replace(/\s+/g, " "));
}

async function twice<Row>(what: string, query: () => Promise<Row[]>, use?: (rows: Row[]) => unknown): Promise<void> {
  await query();
  const rows = await query();
  show(what, rows);
  if (use) console.log("  ->", use(rows));
}

function describe(rows: Sparse[]): string {
  Bun.gc(true);
  return rows.map(row => `${row.id} ${"note" in row} ${row.note ?? "none"} ${"rank" in row} ${(row.rank ?? 100) + 1} ${Object.hasOwn(row, "note")}`).join(" | ");
}
await twice("every optional column", () => sql<Sparse[]>`SELECT complete`, describe);
await twice("no optional column", () => sql<Sparse[]>`SELECT required`, describe);
await twice("an optional column before the required one", () => sql<Sparse[]>`SELECT ranked`, describe);
await twice("null in an optional column", () => sql<Sparse[]>`SELECT noted`, describe);

function addOptionalFields(rows: Sparse[]): void {
  for (const row of rows) {
    row.note = "x";
    console.log(" ", Object.keys(row).join(), "note" in row, row.note.length, JSON.stringify(row));
    row.rank = row.id + 0.5;
    console.log(" ", Object.keys(row).join(), "rank" in row, row.rank * 2, JSON.stringify(row));
    delete row.note;
    row.note = "y";
    console.log(" ", Object.keys(row).join(), Object.entries(row).join(";"), JSON.stringify(row));
  }
}
addOptionalFields(await sql<Sparse[]>`SELECT required`);
addOptionalFields(await sql<Sparse[]>`SELECT ranked`);
addOptionalFields(await sql<Sparse[]>`SELECT complete`);

function total(prices: Price[]): number {
  let sum = 0;
  for (const price of prices) sum += price.amount;
  return sum;
}
function doubleAmounts(prices: Price[]): void {
  for (const price of prices) price.amount *= 2;
}
const amounts = (prices: Price[]) => prices.map(price => (Object.is(price.amount, -0) ? "-0" : String(price.amount))).join();
await twice("int4 around the smallest int32", () => sql<Price[]>`SELECT integers`, total);
await twice("float8 with and without a fraction", () => sql<Price[]>`SELECT doubles`, total);
await twice("float4", () => sql<Price[]>`SELECT singles`, total);
await twice("not a number", () => sql<Price[]>`SELECT invalid`, total);
const mixed: Price[] = [...(await sql<Price[]>`SELECT integers`), ...(await sql<Price[]>`SELECT doubles`), ...(await sql<Price[]>`SELECT singles`)];
Bun.gc(true);
console.log(total(mixed), amounts(mixed));
doubleAmounts(mixed);
Bun.gc(true);
console.log(total(mixed), amounts(mixed), JSON.stringify(mixed));

await twice("as many fields as a typed row can have", () => sql<Full[]>`SELECT full`, rows => rows.map(row => row.c00 + row.c31 + row.c63).join());
await twice("more fields than a typed row can have", () => sql<Huge[]>`SELECT huge`, rows => rows.map(row => `${row.f00 + (row.f69 ?? 0)} ${"f35" in row} ${row.f35}`).join());
await twice("a method that no column provides", () => sql<Labeled[]>`SELECT labeled`, rows => rows.map(row => `${row.id} ${"label" in row} ${typeof row.label}`).join());

const retainedSparse: Sparse[] = [...(await sql<Sparse[]>`SELECT complete`), ...(await sql<Sparse[]>`SELECT required`)];
const retainedFull = await sql<Full[]>`SELECT full`;
const retainedHuge = await sql<Huge[]>`SELECT huge`;
const retainedLabeled = await sql<Labeled[]>`SELECT labeled`;
function countRetainedRows(): string {
  return [retainedSparse.length, mixed.length, retainedFull.length, retainedHuge.length, retainedLabeled.length].join();
}
// Reachable from the global object, the function keeps these rows alive until the exit, where object-census.test.ts counts them by layout.
(globalThis as any).countRetainedRows = countRetainedRows;
console.log("retained", countRetainedRows());

await sql.close();
server.stop(true);
