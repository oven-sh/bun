// A require() that a function makes of the own URL, or that is one side of a choice, or is asked to resolve at once, loads its files where import.meta is handed on.
import { createRequire } from "node:module";
import { note, notes } from "./notes.mjs";
note(import.meta);
const make = () => createRequire(import.meta.url);
console.log(make()("./kiln.json").heat, make()("./potter.cjs").name);
const load = process.argv.length > 90 ? name => ({ heat: name }) : createRequire(import.meta.url);
console.log(load("./kiln.json").heat, load("./potter.cjs").turn(3));
const other = process.argv.length > 90 ? createRequire(import.meta.url) : name => ({ heat: name.length });
console.log(other("./kiln.json").heat);
console.log(typeof createRequire(import.meta.url).resolve("./potter.cjs"), notes.length);
