"use strict";
const log = []; const rows = JSON.parse('[' + Array.from({ length: 64 }, (_, i) => '{"name":"n' + i + '","price":' + (i + 0.5) + ',"count":' + i + '}').join() + ']'); Object.defineProperty(rows[40], 'price', { get() { log.push('got'); return 7; } });
function f(t) { let s = t & 1; for (const row of rows) s += row.price; return s; }
const n = +process.argv[2] || 300; let sum = 0; for (let t = 0; t < n; t++) { try { sum = (sum + f(t)) % 1000003; } catch (e) { sum = (sum + e.constructor.name.length) % 1000003; } } console.log(String(sum), log.length, log.slice(0, 6).join());
