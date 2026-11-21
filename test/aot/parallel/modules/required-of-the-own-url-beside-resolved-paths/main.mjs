// A file that asks import.meta.resolveSync() for a path finds what a require() made of its own URL loads.
import { createRequire } from "node:module";
console.log(typeof import.meta.resolveSync("node:path"));
console.log(createRequire(import.meta.url)("./hive.json").bees);
const load = createRequire(import.meta.url);
console.log(load("./keeper.cjs").name, load("./frames.cjs").count, load("./hive.json") === load("./hive.json"));
console.log(typeof import.meta.resolveSync("node:fs"), import.meta.url === import.meta.url);
