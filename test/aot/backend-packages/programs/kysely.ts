import { Kysely, PostgresDialect, sql, type Generated } from "kysely";
import pg from "pg";
import { fakePostgres } from "./fake_pg.ts";
import { listen } from "./lib_http.ts";

interface Person { id: Generated<number>; name: string }
interface Database { person: Person }

const seen: string[] = [];
const server = fakePostgres(seen);
const port = await listen(server);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new pg.Pool({ host: "127.0.0.1", port, user: "u", password: "p", database: "d", max: 1 }) }) });

const query = db.selectFrom("person").select(["id", "name"]).where("id", "=", 1).orderBy("name");
console.log(query.compile().sql, JSON.stringify(query.compile().parameters));
console.log(JSON.stringify(await query.execute()));
console.log(db.insertInto("person").values({ name: "x" }).returning("id").compile().sql);
console.log(db.selectFrom("person as a").innerJoin("person as b", "a.id", "b.id").select(["a.id", "b.name"]).where(sql<boolean>`a.id > ${3}`).compile().sql);
const first = await db.selectFrom("person").selectAll().executeTakeFirstOrThrow();
console.log(first.id + 1, first.name.toUpperCase());
await db.destroy();
server.close();
console.log(seen.join(" | "));
console.log("DONE");
