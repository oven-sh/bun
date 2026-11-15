import { seen } from "./called-b.js";
export function h() { return "h"; }
export function setH(v) { h = v; }
console.log("called", seen, h());
