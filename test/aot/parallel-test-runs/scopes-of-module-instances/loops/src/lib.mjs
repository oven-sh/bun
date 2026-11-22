import { base } from "./dep.mjs";
export const fs = [];
for (let i = 0; i < 3; i++) { class L { static seen = i; get() { return L.seen + i + base; } } fs.push(() => new L().get()); let j = i; fs.push(() => j++); }
for (const key of ["a", "b"]) { const own = key + base; fs.push(() => own); }
let k = 0; while (k < 2) { const w = k++; class W { static w = w; static get() { return W.w * 10; } } fs.push(() => W.get()); }
for (var v = 0; v < 2; v++) { let c = v; fs.push(() => [v, c].join(":")); }
export function use() { return fs.map(f => f()).join(" "); }
