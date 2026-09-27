import { Database } from "https://deno.land/x/sqlite3@0.12.0/mod.ts";
import { bench, run } from "../runner.mjs";

const db = new Database("./src/northwind.sqlite");

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
  const sql = db.prepare(`SELECT * FROM "Order" WHERE Id = ?`);
  let id = 0;
  bench('SELECT * FROM "Order" WHERE Id = ? (get)', () => {
    sql.get(10248 + (id++ % 1000));
  });
}

{
  const sql = db.prepare(`SELECT * FROM "Product" WHERE Id = ?`);
  let id = 0;
  bench('SELECT * FROM "Product" WHERE Id = ? (get)', () => {
    sql.get(1 + (id++ % 77));
  });
}

{
  // `LIMIT ?` makes SQLite re-prepare the statement when the bound value
  // changes, so this measures the row builder behind a changing plan.
  const sql = db.prepare(`SELECT * FROM "Order" WHERE Id >= ? LIMIT ?`);
  let id = 0;
  bench('SELECT * FROM "Order" WHERE Id >= ? LIMIT ? (get)', () => {
    sql.get(10248 + (id++ % 1000), 1);
  });
}

await run();
