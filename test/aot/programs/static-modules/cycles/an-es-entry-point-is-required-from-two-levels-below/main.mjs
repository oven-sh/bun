// The entry point imports e.mjs, e.mjs imports k.cjs, and k.cjs requires the entry point: under `bun run` that require() runs e.mjs and then the entry point, each once, while k.cjs is still running.
import { fromE } from "./e.mjs";
export const value = "main";
console.log("the entry point runs", fromE);
