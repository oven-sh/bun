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

{
  // The cost of the SQL text itself: one statement of a given size and encoding, and one string of many statements.
  const memory = new Database(":memory:");
  const sized = (bytes, mark) =>
    "select 1/*" + Buffer.alloc(bytes - 12 - Buffer.byteLength(mark), "x").toString() + mark + "*/";

  for (const [encoding, mark] of [
    ["ASCII", ""],
    ["Latin-1", "\u00e9"],
    ["UTF-16", "\u{1F600}"],
  ]) {
    for (const bytes of [24, 1199, 1200, 4096]) {
      const sql = sized(bytes, mark);
      bench(`db.run(sql): ${encoding}, ${bytes} bytes`, () => {
        memory.run(sql);
      });
      bench(`db.prepare(sql): ${encoding}, ${bytes} bytes`, () => {
        memory.prepare(sql).finalize();
      });
    }
  }

  for (const statements of [1000, 2000, 4000, 8000]) {
    const sql = Buffer.alloc(statements * 9, "select 1;").toString();
    bench(`db.exec(sql): ${statements} statements`, () => {
      memory.exec(sql);
    });
  }
}

await run();
