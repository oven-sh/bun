// Run `node --experimental-sqlite bench/sqlite/node.mjs` to run the script.
// You will need `--experimental-sqlite` flag to run this script and node v22.5.0 or higher.
import { DatabaseSync as Database } from "node:sqlite";
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
