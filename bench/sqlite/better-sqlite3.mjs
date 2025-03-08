import { createRequire } from "module";
import { bench, run } from "../runner.mjs";

const require = createRequire(import.meta.url);
const db = require("better-sqlite3")("./src/northwind.sqlite");

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
