import * as library from "bun:sqlite";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
const database = new library.Database(":memory:");
console.log(database.query("select 1 as a").all().length);
