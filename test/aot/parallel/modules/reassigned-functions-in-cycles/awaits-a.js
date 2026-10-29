import { seen } from "./awaits-b.js";
await null;
export function h() { return "h"; }
export function setH(v) { h = v; }
console.log("awaits", seen, typeof h);
