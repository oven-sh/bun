import { and, eq, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, serial, text } from "drizzle-orm/pg-core";
import pg from "pg";
import { fakePostgres } from "./fake_pg.ts";
import { listen } from "./lib_http.ts";

const person = pgTable("person", { id: serial("id").primaryKey(), name: text("name").notNull() });

const seen: string[] = [];
const server = fakePostgres(seen);
const port = await listen(server);
const pool = new pg.Pool({ host: "127.0.0.1", port, user: "u", password: "p", database: "d", max: 1 });
const db = drizzle({ client: pool });

const query = db.select().from(person).where(and(eq(person.id, 1), gt(person.id, 0)));
console.log(JSON.stringify(query.toSQL()));
const rows = await query;
console.log(JSON.stringify(rows), rows.map(row => row.id + 1).join());
console.log(JSON.stringify(db.insert(person).values({ name: "x" }).returning({ id: person.id }).toSQL()));
console.log(JSON.stringify(db.update(person).set({ name: "y" }).where(eq(person.id, 2)).toSQL()));
await pool.end();
server.close();
console.log(seen.join(" | "));
console.log("DONE");
