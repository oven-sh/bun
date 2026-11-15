"use strict";
function pass(x) { globalThis.hidden = x; return globalThis[JSON.parse('"hidden"')]; }
const name = JSON.parse('"price"'); const log = [];
const rows = JSON.parse('[' + Array.from({ length: 64 }, (_, i) => '{"a":' + i + '}').join() + ']');
function f(t) { if (t === 150) rows[30][name] = 3; if (t === 200) Object.defineProperty(rows[31], name, { get() { log.push('got'); return 1; } }); let c = t & 1; for (const row of rows) if (row.price) c++; return c; }
const n = +process.argv[2] || 300; let sum = 0; for (let t = 0; t < n; t++) { try { sum = (sum + f(t)) % 1000003; } catch (e) { sum = (sum + e.constructor.name.length) % 1000003; } } console.log(String(sum), log.length, log.slice(0, 6).join());
