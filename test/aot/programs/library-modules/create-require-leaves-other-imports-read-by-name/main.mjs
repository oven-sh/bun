// `createRequire(import.meta.url)` is followed like the `require` of a file, so the import that brings it says nothing of loads under unknown names: of the other modules of Bun the program keeps the names that it imports.
// STATISTIC: FunctionsLowered <= 800
import { createRequire } from "node:module";
import { basename } from "node:path";
import { format } from "node:util";
import { EventEmitter } from "node:events";
const load = createRequire(import.meta.url);
console.log(load("./data.json").name, basename("/a/b.txt"), format("%s", 1), typeof EventEmitter, typeof load.resolve);
