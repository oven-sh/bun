import { Database } from "bun:sqlite";
import { and, eq, gt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  age: integer("age"),
});
type User = typeof users.$inferSelect;
const sqlite = new Database(":memory:");
sqlite.run("create table users (id integer primary key autoincrement, name text not null, age integer)");
const db = drizzle(sqlite);
await db.insert(users).values([{ name: "Ada", age: 36 }, { name: "Alan", age: 41 }, { name: "Grace" }]);
const older: User[] = await db
  .select()
  .from(users)
  .where(and(gt(users.age, 30), eq(users.name, "Alan")));
console.log(JSON.stringify(older));
console.log(
  JSON.stringify(
    db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .all(),
  ),
);
const query = db.update(users).set({ age: 1 }).where(eq(users.id, 3)).toSQL();
console.log(query.sql, JSON.stringify(query.params));
console.log(JSON.stringify(await db.delete(users).where(eq(users.name, "Ada")).returning()));
