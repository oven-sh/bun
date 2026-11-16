import { base } from "./dep.mjs";
export let total = 0;
export const makers = [];
{ let n = base; class Counter { static count = 0; constructor() { this.id = ++Counter.count; n += 10; } get n() { return n; } } makers.push(() => new Counter()); function hoisted() { return n + Counter.count; } makers.push(hoisted); }
try { const t = 3 + base; makers.push(() => t); throw new Error("x"); } catch (error) { const m = error.message; makers.push(() => m + (total++)); } finally { const f = () => total; makers.push(f); }
switch (base) { case 1: let s = "one"; makers.push(() => s += "!"); break; default: makers.push(() => "other"); }
label: { const inside = base * 7; makers.push(() => inside); if (inside) break label; }
if (base) { const only = { v: base }; makers.push(() => only.v++); } else { const only = 2; makers.push(() => only); }
export function use() { return makers.map(m => { const v = m(); return typeof v === "object" ? v.id + ":" + v.n : String(v); }).join(" "); }
