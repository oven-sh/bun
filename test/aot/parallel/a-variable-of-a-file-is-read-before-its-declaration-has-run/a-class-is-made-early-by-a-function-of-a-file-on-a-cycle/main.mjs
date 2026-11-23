import "./caller.mjs";
import { Point } from "./holder.mjs";
export function makePoint() { return new Point(3).x; }
console.log("main", makePoint());
