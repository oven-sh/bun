// `export { a } from "node:process"` reads nothing off process: the object lists a member from its first read, so an early read shows in the key order.
// Alone: another entry point that imports one of the names has it read for all
export { hrtime as clock, uptime, release } from "node:process";
export { which } from "bun";
export { createRequire } from "node:module";
import Module from "node:module";
const held = [process.cwd, Bun.sleep, Module.isBuiltin];
Object.entries(process); console.log(Reflect.ownKeys(process).slice(4, 12).join());
Object.entries(Bun); console.log(Reflect.ownKeys(Bun).slice(0, 6).join());
Object.entries(Module); console.log(Reflect.ownKeys(Module).slice(0, 10).join());
