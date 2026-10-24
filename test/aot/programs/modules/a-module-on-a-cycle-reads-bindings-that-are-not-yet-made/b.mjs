import D, { a, fa } from "./a.mjs";
let r = [];
for (const f of [() => a, () => fa(), () => D, () => typeof fa]) { try { r.push(String(f())); } catch (e) { r.push(e.name); } }
export const b = r.join();
