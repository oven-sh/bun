import { lines, show, log, attempt, setAcc, acc, box, list0, table, KEY, x, P, Q, R, gen, gen2, hand, wrap, wrap2, structured } from './state.mjs';
import { main } from './main.mjs';
let cb = (v, d) => port0(v, box.k, d - 1);
function pass(v, d) { for (const z of gen(v)) { setAcc(port0(z, v, d - 1)); } return acc; }
function via(v, d) { if (d < 0) return v; return d & 1 ? port0(v, w0, d) : via(wrap(v), d - 1); }
var w0 = { k: 0 };
function port0(v, w, d) { if (d < 0) return w; log('fl', v.filter((q) => q)); table.set(d, v); return acc; }
export { cb, pass, via, port0 };
export const isMain = typeof main;
