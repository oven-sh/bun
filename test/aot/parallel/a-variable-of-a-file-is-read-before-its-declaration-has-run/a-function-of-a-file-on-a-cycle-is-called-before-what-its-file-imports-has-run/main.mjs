import "./caller.mjs";
import { limit } from "./holder.mjs";
export function readLimit() { return limit; }
console.log("main", readLimit());
