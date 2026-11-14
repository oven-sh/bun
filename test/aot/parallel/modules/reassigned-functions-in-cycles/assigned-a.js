import { seen } from "./assigned-b.js";
export function h() { return "h"; }
export function setH(v) { h = v; }
console.log("assigned", seen, typeof h, h);
