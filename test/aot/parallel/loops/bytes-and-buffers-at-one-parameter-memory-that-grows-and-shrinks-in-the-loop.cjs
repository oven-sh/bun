// STATISTIC: AccessesInsideViews >= 1
'use strict';
const said = [];
const attempt = (f) => { try { return f(); } catch (error) { return error.constructor.name; } };
const q = +(process.argv[2] ?? 3);
const b = Buffer.alloc(100, 7), u = new Uint8Array(100).fill(5);
const hidden = (f) => ({ f })[JSON.parse('"f"')];
const memory = new ArrayBuffer(8, { maxByteLength: 64 }); const tracking = new Uint8Array(memory); tracking.fill(1);
const walk = (p, grow) => { let s = 0; for (let i = 0; i < p.length; i++) { s += p[i] + 1; if (grow && i === q) memory.resize(16); if (grow && i === q + 6) memory.resize(4); } return s; };
said.push(walk(b, false), walk(u, false), walk(tracking, true), tracking.length);
console.log(said.join(' | '));
