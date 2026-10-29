import { seen } from "./inner-b.js";
function h() { return "h"; }
export function call() { return h(); }
export function replace() { const was = h; h = () => "other"; return was; }
console.log("inner", seen, h());
