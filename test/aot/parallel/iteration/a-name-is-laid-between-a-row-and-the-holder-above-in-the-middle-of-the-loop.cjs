"use strict";
function pass(x) { globalThis.hidden = x; return globalThis[JSON.parse('"hidden"')]; }
const name = JSON.parse('"price"'); const log = [];
const above = {}; above[name] = 1.5; const middle = Object.create(above); const rows = pass(Array.from({ length: 64 }, () => Object.create(middle))); let calls = 0; Object.defineProperty(rows[20], name, { get() { if (++calls === 150) middle[name] = 7; if (calls === 220) delete middle[name]; return 0; } });
function f(t) { let s = t & 1; for (const row of rows) s += row.price; return s; }
const n = +process.argv[2] || 300; let sum = 0; for (let t = 0; t < n; t++) { try { sum = (sum + f(t)) % 1000003; } catch (e) { sum = (sum + e.constructor.name.length) % 1000003; } } console.log(String(sum), log.length, log.slice(0, 6).join());
