import * as library from "node:sqlite";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
const database = new library.DatabaseSync(":memory:");
console.log(database.prepare("select 1 as a").all().length);
