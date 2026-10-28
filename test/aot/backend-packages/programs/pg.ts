import pg from "pg";
import { fakePostgres } from "./fake_pg.ts";
import { listen } from "./lib_http.ts";

const seen: string[] = [];
const server = fakePostgres(seen);
const port = await listen(server);
const config = { host: "127.0.0.1", port, user: "u", password: "p", database: "d" };

const client = new pg.Client(config);
await client.connect();
const simple = await client.query("select id, name from person");
console.log(JSON.stringify(simple.rows), simple.rowCount, simple.fields.map(f => f.name + ":" + f.dataTypeID).join());
const bound = await client.query<{ id: number; name: string }>("select id, name from person where id = $1", [1]);
console.log(bound.rows.map(row => typeof row.id + " " + row.name).join());
await client.end();

const pool = new pg.Pool({ ...config, max: 2 });
const both = await Promise.all([pool.query("select 1"), pool.query({ text: "select $1::int", values: [5], rowMode: "array" })]);
console.log(JSON.stringify(both.map(result => result.rows)));
await pool.end();
server.close();
console.log(seen.sort().join(" | "));
console.log("DONE");
