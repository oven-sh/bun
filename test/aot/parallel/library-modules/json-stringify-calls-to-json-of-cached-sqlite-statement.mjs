// db.query() answers a statement out of a cache, so the compiler no longer tells it apart from other values. JSON.stringify still calls its toJSON.
import { Database } from "bun:sqlite";
const db = new Database(":memory:");
console.log(JSON.stringify(db.query("select 1 as one")));
console.log(JSON.stringify({ nested: [db.query("select 2 as two")] }));
