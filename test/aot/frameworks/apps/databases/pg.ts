import pg, { type QueryConfig } from "pg";

const { Client, Pool, types, escapeIdentifier, escapeLiteral } = pg;
console.log(
  escapeIdentifier('a"b'),
  escapeLiteral("it's \\ here"),
  types.getTypeParser(20)("12"),
  types.getTypeParser(1184)("2020-01-01 00:00:00+00") instanceof Date,
  JSON.stringify(types.getTypeParser(types.builtins.JSON)('{"a":[1,2]}')),
);
const query: QueryConfig = { text: "select $1::int", values: [1] };
const client = new Client({ host: "127.0.0.1", port: 1, user: "u", database: "d", connectionTimeoutMillis: 2000 });
try {
  await client.connect();
  await client.query(query);
} catch (error) {
  console.log((error as NodeJS.ErrnoException).code, (error as Error).name);
}
const pool = new Pool({ host: "127.0.0.1", port: 1, max: 2 });
console.log(pool.totalCount, pool.idleCount, pool.waitingCount);
await pool.end();
