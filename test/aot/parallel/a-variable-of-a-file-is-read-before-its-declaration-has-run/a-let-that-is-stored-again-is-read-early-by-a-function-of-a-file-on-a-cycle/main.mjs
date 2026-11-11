import "./caller.mjs";
import { count, bump } from "./holder.mjs";
export function readCount() { return count; }
bump();
console.log("main", readCount());
