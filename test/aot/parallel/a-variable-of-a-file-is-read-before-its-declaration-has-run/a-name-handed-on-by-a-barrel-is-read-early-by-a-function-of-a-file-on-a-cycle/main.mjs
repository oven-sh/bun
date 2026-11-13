import "./caller.mjs";
import { limit } from "./barrel.mjs";
export function readLimit() { return limit; }
console.log("main", readLimit());
