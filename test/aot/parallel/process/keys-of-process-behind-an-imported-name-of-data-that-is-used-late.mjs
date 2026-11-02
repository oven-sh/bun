// A name of "node:process" that holds data is read where it is imported, not where it is first used.
import { release as taken } from "node:process";
const listed = process; const held = [];
held.push(process.cwd);
console.log(typeof taken);
held.push(process.hrtime);
console.log(Object.entries(listed).map(([key]) => key).join());
