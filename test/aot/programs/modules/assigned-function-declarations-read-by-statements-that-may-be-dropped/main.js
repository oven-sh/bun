// A function declaration whose name is assigned to is read by declarations at the top level that the build may leave out, one used and one not, after a module that ran earlier has called it.
import { seen } from "./other.js";
export function h() { return "h"; }
export function setH(v) { h = v; }
const unused = { f: h };
export const table = { f: h, g: [h] };
console.log(seen, table.f === h, table.g[0] === h);
