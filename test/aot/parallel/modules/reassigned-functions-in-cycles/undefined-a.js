import { seen } from "./undefined-b.js";
export function h() { return "h"; }
export function k() { return "k"; }
export function set(v, w) { h = v; k = w; }
console.log("undefined", seen, h, k);
