// The names of modules of the library come about at run time, so the loader asks native code for each: what it hands out is a module that any program may name.
import { createRequire } from "node:module";
import "node:fs";
import "node:util";
import "node:events";
import "node:timers/promises";
import "node:path";

const require = createRequire(import.meta.url);
const names = ["fs", "util", "events", "timers/promises", "path"].map(name => ["node", name].join(":"));
for (const name of names) {
  const required = require(name);
  const imported = await import(name);
  console.log(name, typeof required, imported.default === required, Object.keys(imported).length > 1);
}
for (const name of ["internal:util/inspect", "bun:sql"]) {
  try {
    console.log(name, typeof require(name));
  } catch (error) {
    console.log(name, "is refused:", error.code ?? error.name);
  }
}
console.log(typeof process.binding("util").isDate);
