// A link reads every name that a statement imports from "node:process", used or not: process lists the name from then on.
// Alone: another entry point that uses the name has it read for all
import { hrtime } from "node:process";
const held = [process.cwd];
Object.entries(process); console.log(Reflect.ownKeys(process).slice(4, 12).join());
