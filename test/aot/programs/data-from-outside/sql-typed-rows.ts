// sql<Row[]>`..` decodes each row from the wire into a typed object of Row. A row that does not match Row is created as a plain object, as before.
// A callback called with such rows gets a typed body, and an untyped clone for rows that do not match.
// IR+ ^layout (L\d+) .*name="Comment" [\s\S]*^function f\d+ (-|"[^"]*") Arrow .*\((undefined\|null\|)?=?\1!?[,)]
// An object literal that such a callback returns is allocated as the type the enclosing call is expected to return.
// IR+ ^layout (L\d+) .*name="Summary" [\s\S]*: =?\1 = NewObject 
// IR+ ^layout (L\d+) .*name="Author" [\s\S]*: =?\1 = NewObject 
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

interface Comment {
  id: number;
  parentId: number | null;
  body: string;
  isHidden: boolean;
  score: number;
  createdAt: Date;
  editedAt: Date | null;
  state: "open" | "closed";
}
interface Named {
  name: string;
  id: number;
}
interface Wide extends Named {
  views: string;
  ratio: number;
  key: string;
  mood: string;
  at: Date;
}

const micro = (iso: string) => BigInt(Date.parse(iso) - 946684800000) * 1000n;
tables.set("comments", {
  columns: [["id", "int4"], ["parentId", "int4"], ["body", "text"], ["isHidden", "bool"], ["score", "float8"], ["createdAt", "timestamptz"], ["editedAt", "timestamptz"], ["state", "varchar"]],
  rows: [
    [1, null, "first", false, 1.5, micro("2026-05-07T16:30:56.123Z"), null, "open"],
    [2, 1, "", true, -0, micro("1999-12-31T23:59:59.999Z") + 1n, micro("2026-05-08T00:00:00.000Z"), "closed"],
    [-2147483648, 2147483647, "naïve — 日本語 🙂", false, NaN, micro("1969-07-20T20:17:40.000Z"), null, "open"],
    [4, 2, "x".repeat(300), true, 3, 0n, 1n, "closed"],
  ],
});
tables.set("turned", { columns: [["id", "int4"], ["name", "text"]], rows: [[1, "a"], [2, "b"]] });
tables.set("wide", {
  columns: [["mood", "mood"], ["key", "uuid"], ["id", "int4"], ["ratio", "float4"], ["views", "int8"], ["name", "varchar"], ["at", "timestamp"]],
  rows: [["happy", "6f1c1f0e-0000-4000-8000-000000000001", 7, 0.25, "9007199254740993", "n", micro("2026-01-02T03:04:05.006Z")]],
});
tables.set("lying", {
  columns: [["id", "int4"], ["parentId", "int4"], ["body", "text"], ["isHidden", "bool"], ["score", "float8"], ["createdAt", "timestamptz"], ["editedAt", "timestamptz"], ["state", "varchar"]],
  rows: [
    [1, null, "fits", false, 1, 0n, null, "open"],
    [null, null, "no id", false, 1, 0n, null, "open"],
    [3, null, null, false, 1, 0n, null, "open"],
    [4, null, "another state", false, 1, 0n, null, "merged"],
    [5, null, "the end of time", false, 1, 9223372036854775807n, null, "open"],
    [6, null, "fits again", true, 2, 1000n, 2000n, "closed"],
  ],
});
tables.set("more", { columns: [["id", "int4"], ["name", "text"], ["extra", "int4"]], rows: [[1, "a", 10]] });
tables.set("fewer", { columns: [["id", "int4"]], rows: [[1]] });
tables.set("other", { columns: [["id", "text"], ["name", "int4"]], rows: [["one", 1]] });
tables.set("twice", { columns: [["id", "int4"], ["name", "text"], ["id", "int4"]], rows: [[1, "a", 2]] });
tables.set("document", { columns: [["id", "int4"], ["name", "json"]], rows: [[1, '{"a":[1,2]}']] });
tables.set("nothing", { columns: [["id", "int4"], ["name", "text"]], rows: [] });

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

await twice("every kind", () => sql<Comment[]>`SELECT comments`, rows =>
  rows.map(row => `${row.id + 1} ${row.parentId ?? "none"} ${row.body.length} ${!row.isHidden} ${Object.is(row.score, -0)} ${row.createdAt.getTime()} ${row.editedAt?.toISOString()} ${row.state === "open"}`).join(" | "),
);
await twice("columns in another order than the fields", () => sql<Named[]>`SELECT turned`, rows => rows.map(({ name, id }) => name + id).join());
await twice("inherited fields, texts of many types", () => sql<Wide[]>`SELECT wide`, rows => rows[0]!.views + rows[0]!.mood + rows[0]!.at.getUTCMilliseconds());
await twice("rows that are no Comment among rows that are", () => sql<Comment[]>`SELECT lying`);
await twice("a column more than the type has", () => sql<Named[]>`SELECT more`);
await twice("a column fewer", () => sql<Named[]>`SELECT fewer`);
await twice("columns of other types", () => sql<Named[]>`SELECT other`);
await twice("a name twice", () => sql<Named[]>`SELECT twice`);
await twice("a type that is parsed", () => sql<Named[]>`SELECT document`);
await twice("no rows", () => sql<Named[]>`SELECT nothing`, rows => rows.length);
await twice("as arrays", () => sql<Named[]>`SELECT turned`.values());
await twice("no type", () => sql`SELECT turned`);

interface Author {
  login: string;
}
interface Summary {
  id: number;
  author: Author;
  isReply: boolean;
  at: Date;
}

function describe(summaries: Summary[]): string {
  let text = "";
  for (const summary of summaries) text += `${summary.id}:${summary.author.login.length}:${summary.isReply}:${summary.at.getTime()} `;
  return text;
}

async function summarize(): Promise<Summary[]> {
  const rows = await sql<Comment[]>`SELECT comments`;
  return rows.map(row => ({ id: row.id, author: { login: row.body }, isReply: row.parentId !== null, at: row.createdAt }));
}
console.log(describe(await summarize()));
console.log(describe(await summarize()));

async function inspectMismatches(): Promise<void> {
  const rows = await sql<Comment[]>`SELECT lying`;
  console.log(
    rows.map(row => row.id).join(),
    rows.filter(row => row.isHidden).length,
    rows.find(row => row.state !== "open" && row.state !== "closed")?.body,
    rows.map((row, index) => `${index}${typeof row.body}${typeof row.createdAt}`).join(),
    rows.some(row => row.id === null),
  );
}
await inspectMismatches();
await inspectMismatches();

const [first] = await sql<Named[]>`SELECT turned`;
const loose: any = first;
loose.id = 5;
loose.added = [1];
console.log(JSON.stringify(first), Object.keys(first!).join(), first instanceof Object, Object.getPrototypeOf(first) === Object.prototype);
const result: any = await sql<Named[]>`SELECT turned`;
console.log(result.count, result.command, Array.isArray(result), result.length, result.constructor.name);

await sql.close();
server.stop(true);
Bun.gc(true);
