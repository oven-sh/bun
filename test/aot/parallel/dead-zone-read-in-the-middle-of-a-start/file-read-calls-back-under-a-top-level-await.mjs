function read() { try { return late.rate; } catch (error) { return error.name; } }
let seen = "not run";
import { readFile } from "node:fs";
await new Promise(resolve => readFile(import.meta.filename ?? process.argv[1], () => { seen = read(); resolve(); }));
const late = { rate: 0.2 };
console.log(seen, read());
