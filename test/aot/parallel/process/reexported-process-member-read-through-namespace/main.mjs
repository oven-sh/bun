// A member that another file re-exports from "node:process" is read off process when the namespace object is first asked for it, and kept from then on.
// Alone: another entry point that imports one of the names has it read for all
import * as barrel from "./barrel.mjs";
const held = [process.cwd];
const keys = () => Reflect.ownKeys(process).slice(4, 12).join();
const original = process.uptime;
process.uptime = () => "replaced";
console.log(typeof barrel.hrtime, Object.keys(barrel).join());
held.push(process.memoryUsage);
console.log(barrel.uptime === original, barrel.uptime(), barrel.uptime === barrel.uptime);
process.uptime = original;
console.log(barrel.uptime());
const later = await import("./barrel.mjs");
console.log(later === barrel, typeof later.hrtime(), later.title === process.title);
Object.entries(process); console.log(keys());
