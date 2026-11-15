import { Box, Deep, tools, make } from "./lib.mjs";
import * as lib from "./lib.mjs";
export function own(n) { const box = new Box(1); let sum = 0; for (let i = 0; i < n; i++) sum += box.sum(i) + box.size + Box.where() + tools.add(i); return sum; }
export function made(n) { let sum = 0; for (let i = 0; i < n; i++) sum += make(i).sum(1) + Box.make(i).size + new Deep(i).sum(1); return sum; }
export function during(box, n, act) { let out = []; for (let i = 0; i < n; i++) { out.push(box.sum(i), box.size); act(i); out.push(box.sum(i), box.size); } return out.join(" "); }
export function strings(n) { let sum = 0; for (let i = 0; i < n; i++) sum += lib.make(i).sum(i) + lib.tools.now; return sum; }
