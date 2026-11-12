function read() { try { return late.rate; } catch (error) { return error.name; } }
let seen = "not run";
import { readFile } from "node:fs";
readFile(import.meta.filename ?? process.argv[1], () => { seen = read(); });
await new Promise(resolve => setTimeout(resolve, 60));
const late = { rate: 0.2 };
console.log(seen, read());
