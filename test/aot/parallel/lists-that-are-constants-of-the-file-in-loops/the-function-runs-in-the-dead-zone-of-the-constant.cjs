"use strict";
function sum(n) { let s = 0; for (let i = 0; i < n; i++) s += table[i]; return s; }
function guarded(n) { try { return sum(n); } catch (e) { return e.constructor.name; } }
const early = []; for (let r = 0; r < 4; r++) early.push(guarded(r));
const table = []; for (let k = 0; k < 4; k++) table[k] = k + 1;
function step(r) { return r ? guarded(r & 3) : early.join(); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
