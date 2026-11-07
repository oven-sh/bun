// A query answers rows of the type it is written under, whatever holds the function that makes it: the log stays empty.
// Nothing in the program makes a Row: the rows do.
// Flags: --aot-log-type-mismatches
// STATISTIC: TypedResultsSelected >= 7
import { sql, SQL } from "bun";

const OID = { bool: 16, int4: 23, text: 25, float8: 701 } as const;
type Kind = keyof typeof OID;
const columns: [string, Kind][] = [
  ["id", "int4"],
  ["name", "text"],
  ["isHidden", "bool"],
  ["score", "float8"],
];
const cells: [number, string, boolean, number][] = [
  [1, "first", false, 1.5],
  [2, "", true, -0],
  [-2147483648, "naïve 日本語", false, 3],
];

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

function bytesOf(kind: Kind, cell: number | string | boolean, asBytes: boolean): Buffer {
  if (kind === "text") return Buffer.from(String(cell));
  if (!asBytes) return Buffer.from(kind === "bool" ? (cell ? "t" : "f") : Object.is(cell, -0) ? "-0" : String(cell));
  const bytes = Buffer.alloc(kind === "bool" ? 1 : kind === "int4" ? 4 : 8);
  if (kind === "bool") bytes[0] = cell ? 1 : 0;
  else if (kind === "int4") bytes.writeInt32BE(Number(cell));
  else bytes.writeDoubleBE(Number(cell));
  return bytes;
}

function answer(type: string, body: Buffer, state: { formats: number[] }): Buffer {
  if (type === "P") return message("1");
  if (type === "D") {
    const described = columns.map(([name, kind]) =>
      Buffer.concat([text(name), int32(0), int16(0), int32(OID[kind]), int16(-1), int32(-1), int16(0)]),
    );
    return Buffer.concat([message("t", int16(0)), message("T", int16(columns.length), ...described)]);
  }
  if (type === "B") {
    let at = body.indexOf(0, body.indexOf(0) + 1) + 1;
    at += 2 + 2 * body.readInt16BE(at);
    at += 2;
    const count = body.readInt16BE(at);
    state.formats = [];
    for (let index = 0; index < count; index++) state.formats.push(body.readInt16BE(at + 2 + 2 * index));
    return message("2");
  }
  if (type === "E") {
    const rows = cells.map(row => {
      const parts = row.map((cell, index) => {
        const bytes = bytesOf(columns[index]![1], cell, index < state.formats.length && state.formats[index] === 1);
        return Buffer.concat([int32(bytes.length), bytes]);
      });
      return message("D", int16(row.length), ...parts);
    });
    return Buffer.concat([...rows, message("C", text("SELECT " + cells.length))]);
  }
  return type === "S" ? message("Z", Buffer.from("I")) : Buffer.alloc(0);
}

const server = Bun.listen<{ pending: Buffer; hasStarted: boolean; formats: number[] }>({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    open(socket) {
      socket.data = { pending: Buffer.alloc(0), hasStarted: false, formats: [] };
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

const url = `postgres://user@127.0.0.1:${server.port}/database`;
process.env.DATABASE_URL = url;
const own = new SQL({ url, max: 1 });
const holder = { database: own };

interface Row {
  id: number;
  name: string;
  isHidden: boolean;
  score: number;
}

function describe(rows: Row[]): string {
  let described = "";
  for (const row of rows)
    described += `${row.id + 1}:${row.name.length}:${!row.isHidden}:${Object.is(row.score, -0)}:${row.score * 2} `;
  return described + Object.keys(rows[0]!).join();
}

const throughParameter = async (database: SQL) => describe(await database<Row[]>`SELECT rows`);
const returned = () => own<Row[]>`SELECT rows`;
async function declared(): Promise<string> {
  const rows: Row[] = await own`SELECT rows`;
  return describe(rows);
}

// The first run of a statement on a connection brings every column as text.
await sql`SELECT rows`;
await own`SELECT rows`;

console.log("imported", describe(await sql<Row[]>`SELECT rows`));
console.log("member", describe(await Bun.sql<Row[]>`SELECT rows`));
console.log("under a key", describe(await Bun["sql"]<Row[]>`SELECT rows`));
console.log("instance", describe(await own<Row[]>`SELECT rows`));
console.log("field", describe(await holder.database<Row[]>`SELECT rows`));
console.log("parameter", await throughParameter(own), await throughParameter(sql));
console.log("returned", describe(await returned()));
console.log("declared", await declared());

await sql.close();
await own.close();
server.stop(true);
