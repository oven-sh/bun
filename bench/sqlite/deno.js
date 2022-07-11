import { DB } from 'https://deno.land/x/sqlite/mod.ts';
import { run, bench } from '../node_modules/mitata/src/cli.mjs';

const db = new DB('./src/northwind.sqlite');

{
  const sql = db.prepareQuery(`SELECT * FROM "Order"`);
  bench('SELECT * FROM "Order"', () => {
    sql.allEntries();
  });
}

{
  const sql = db.prepareQuery(`SELECT * FROM "Product"`);
  bench('SELECT * FROM "Product"', () => {
    sql.allEntries();
  });
}

{
  const sql = db.prepareQuery(`SELECT * FROM "OrderDetail"`);
  bench('SELECT * FROM "OrderDetail"', () => {
    sql.allEntries();
  });
}

await run();