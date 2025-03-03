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

await run();
