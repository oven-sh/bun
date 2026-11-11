import "./caller.mjs";
import * as holder from "./holder.mjs";
export function readLimit() { return holder.limit; }
console.log("main", readLimit());
