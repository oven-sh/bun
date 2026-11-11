"use strict";
function fresh(n) { const l = []; for (let k = 0; k < n; k++) l.push(k); return l; }

const kept = fresh(6);
function fill(a, b, n, by) { try { for (let i = 0; i < n; i++) { a[i] = (i * by) | 0; b[i] = (i + by) | 0; } return a.join() + "|" + b.join(); } catch (e) { return e.constructor.name + a.join() + "|" + b.join(); } }
function step(r) { if (r === 7) Object.freeze(kept); return fill(fresh(6), kept, 6, r); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
