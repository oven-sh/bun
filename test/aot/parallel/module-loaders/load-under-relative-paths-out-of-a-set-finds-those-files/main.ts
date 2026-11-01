// The names reach import() and require() through a Set and a table. The build knows what each may be, and every one finds a module of the executable:
// a relative path finds the file that it names from the folder of this file, with or without its extension, or the index file of a folder.
// So neither load can be refused at run time, and the build warns about neither.
// Build prints: 0 x warn: TS100064: this import path isn't a constant. If it resolves to code that isn't in the executable, the import throws at run time (data files still load). Add the file as an entry point, or build with --aot-allow-code-from-disk
// STATISTIC: FlowEdgesLogged <= 44000
import { createRequire } from "node:module";
import { count } from "./app/registry.ts";

const plugins = new Set<string>(["./app/one.ts", "./app/two", "./app/folder", "os"]);
const table: Record<string, string> = { first: "./app/three.cjs", second: "node:path" };

const lines: string[] = [];
for (const name of plugins) {
  const loaded = await import(name);
  lines.push(`${name}: ${typeof loaded.run === "function" ? loaded.run() : typeof loaded.platform}`);
}
for (const key of Object.keys(table)) {
  const loaded = require(table[key]);
  lines.push(`${key}: ${typeof loaded.run === "function" ? loaded.run() : typeof loaded.join}`);
}
lines.push(`${typeof createRequire} ${count}`);
console.log(lines.join("\n"));
