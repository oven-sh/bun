import { limit } from "./holder.mjs";
export function readLimit() { return limit; }
export let seen;
try { seen = readLimit(); } catch (error) { seen = "threw " + error.constructor.name + ": " + error.message; }
