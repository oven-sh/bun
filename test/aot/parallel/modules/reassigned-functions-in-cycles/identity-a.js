import { early, earlyAgain } from "./identity-b.js";
export function h() { return "h"; }
export function setH(v) { h = v; }
export function get() { return h; }
h.mark = (h.mark ?? "") + "a";
console.log("identity", early === h, earlyAgain === h, get() === h, h.mark, h.name, h.length);
