import { seen } from "./namespace-b.js";
export function h() { return "h"; }
export function setH(v) { h = v; }
console.log("namespace", seen, h);
