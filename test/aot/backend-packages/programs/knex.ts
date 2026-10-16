import knex from "knex";
import { fakePostgres } from "./fake_pg.ts";
import { listen } from "./lib_http.ts";

const seen: string[] = [];
const server = fakePostgres(seen);
const port = await listen(server);
const db = knex({ client: "pg", version: "16.0", connection: { host: "127.0.0.1", port, user: "u", password: "p", database: "d" }, pool: { min: 0, max: 1 } });

console.log(JSON.stringify(db("person").select("id", "name").where({ id: 1 }).orderBy("name").toSQL().toNative()));
console.log(JSON.stringify(await db<{ id: number; name: string }>("person").select("id", "name").where("id", 1)));
console.log(db("person").insert({ name: "x" }).returning("id").toString());
console.log(db.schema.createTable("t", table => { table.increments("id"); table.string("name").notNullable(); }).toString());
await db.destroy();
server.close();
console.log(seen.join(" | "));
console.log("DONE");
