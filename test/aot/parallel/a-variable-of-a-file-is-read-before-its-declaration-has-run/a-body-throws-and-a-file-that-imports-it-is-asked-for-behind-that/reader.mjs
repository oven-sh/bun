import { limit } from "./holder.mjs";
export function readLimit() { return limit; }
console.log("reader", readLimit());
