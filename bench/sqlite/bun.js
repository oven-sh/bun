import { Database } from "bun:sqlite";
import { bench, run } from "../runner.mjs";
import { join } from "path";

const db = Database.open(join(import.meta.dir, "src", "northwind.sqlite"));

{
  const sql = db.prepare(`SELECT * FROM "Order"`);
  bench('SELECT * FROM "Order"', () => {
    sql.all();
  });
}

{
  const sql = db.prepare(`SELECT * FROM "Product"`);
  bench('SELECT * FROM "Product"', () => {
    sql.all();
  });
}

{
  const sql = db.prepare(`SELECT * FROM "OrderDetail"`);
  bench('SELECT * FROM "OrderDetail"', () => {
    sql.all();
  });
}

// Statements that a program keeps and runs many times: the cost of one call.
{
  const mem = new Database(":memory:");
  const wideColumns = Array.from({ length: 19 }, (_, i) => `c${i}`);
  mem.run("CREATE TABLE narrow (id INTEGER PRIMARY KEY, name TEXT, email TEXT, n INTEGER)");
  mem.run(`CREATE TABLE wide (id INTEGER PRIMARY KEY, ${wideColumns.map(name => `${name} INTEGER`).join(", ")})`);
  mem.run("CREATE TABLE counter (n INTEGER)");
  mem.run("INSERT INTO counter VALUES (0)");
  mem.run("CREATE TABLE setting (key TEXT PRIMARY KEY, value TEXT)");
  const longColumns = Array.from({ length: 8 }, (_, i) => `customer_account_billing_address_line_${i}`);
  mem.run(`CREATE TABLE long_names (${longColumns.map(name => `${name} TEXT`).join(", ")})`);
  mem.run(`INSERT INTO long_names VALUES (${longColumns.map((_, i) => `'${i}'`).join(", ")})`);
  mem.run('CREATE TABLE "顧客" ("名前" TEXT, "メール" TEXT, "住所" TEXT, "prénom" TEXT)');
  mem.run(`INSERT INTO "顧客" VALUES ('a', 'b', 'c', 'd')`);
  {
    const narrow = mem.prepare("INSERT INTO narrow VALUES (?, ?, ?, ?)");
    const wide = mem.prepare(`INSERT INTO wide VALUES (?, ${wideColumns.map(() => "?").join(", ")})`);
    mem.transaction(() => {
      for (let i = 1; i <= 1000; i++) {
        narrow.run(i, `user ${i}`, `user${i}@example.com`, i * 7);
        wide.run(i, ...wideColumns.map((_, j) => i * j));
      }
    })();
  }

  class Row {}
  const byId = mem.prepare("SELECT * FROM narrow WHERE id = ?");
  const asRow = mem.prepare("SELECT * FROM narrow WHERE id = ?").as(Row);
  const everyRow = mem.prepare("SELECT * FROM narrow");
  // The bundled SQLite compiles these statements again each time the parameter is bound.
  const limitNarrow = mem.prepare("SELECT * FROM narrow LIMIT ?");
  const limitWide = mem.prepare("SELECT * FROM wide LIMIT ?");
  const limitLongNames = mem.prepare("SELECT * FROM long_names LIMIT ?");
  const limitNonAscii = mem.prepare('SELECT * FROM "顧客" LIMIT ?');
  const like = mem.prepare("SELECT * FROM narrow WHERE name LIKE ?");
  const join = mem.prepare("SELECT * FROM narrow JOIN wide ON wide.id = narrow.id LIMIT ?");
  const selfJoin = mem.prepare("SELECT * FROM narrow a JOIN narrow b ON b.id = a.id LIMIT ?");
  const write = mem.prepare("UPDATE counter SET n = n + 1");
  const upsert = mem.prepare("INSERT OR REPLACE INTO setting VALUES ('theme', ?) RETURNING *");

  bench("get(): WHERE id = ?", () => byId.get(500));
  bench("as(Class).get(): WHERE id = ?", () => asRow.get(500));
  bench("query().as(Class).get(): WHERE id = ?", () => mem.query("SELECT * FROM narrow WHERE id = ?").as(Row).get(500));
  bench("get(): LIMIT ?, 4 columns", () => limitNarrow.get(1));
  let limit = 0;
  bench("get(): LIMIT ?, 4 columns, another limit on each call", () => limitNarrow.get((limit++ & 7) + 1));
  bench("get(): LIMIT ?, 20 columns", () => limitWide.get(1));
  bench("get(): LIMIT ?, 8 long column names", () => limitLongNames.get(1));
  bench("get(): LIMIT ?, 4 column names that are not ASCII", () => limitNonAscii.get(1));
  bench("all(): LIMIT ?, 4 columns, 10 rows", () => limitNarrow.all(10));
  bench("all(): LIMIT ?, 20 columns, 10 rows", () => limitWide.all(10));
  bench("all(): WHERE name LIKE ?, 11 rows", () => like.all("user 99%"));
  bench("get(): join with a duplicate column name, LIMIT ?", () => join.get(1));
  bench("get(): self-join, each column name twice, LIMIT ?", () => selfJoin.get(1));
  bench("iterate(): 1,000 rows", () => {
    for (const _ of everyRow.iterate()) {
    }
  });
  bench("values(): 1,000 rows", () => everyRow.values());
  bench("run(): UPDATE", () => write.run());
  bench("get(): INSERT OR REPLACE ... RETURNING *", () => upsert.get("dark"));
  bench("run() of a write, then get()", () => {
    write.run();
    byId.get(500);
  });
}

await run();
