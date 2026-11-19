// COUNTER: ObjectsParsedIntoRecords = 0
// COUNTER: ObjectsParsedIntoOrdinaryObjects = 64
'use strict';
const rows = JSON.parse('[' + Array.from({ length: 64 }, (_, i) => '{"x":' + (i + 0.5) + ',"y":' + (i * 0.5 + 0.25) + ',"vx":' + (i * 0.25 + 0.125) + ',"vy":0.5}').join() + ']');
function made(i) { const v = { x: i + 0.5, y: i * 0.5 + 0.25, vx: i * 0.25 + 0.125, vy: 0.5 }; return v.x + v.y + v.vx + v.vy; }
globalThis.kept = made(3);
function step(list, dt) { for (let i = 0; i < list.length; i++) { const p = list[i]; p.vy += 9.8 * dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.y > 100) { p.y = 100; p.vy = -p.vy * 0.9 - 1; } if (p.x < 0 || p.x > 100) p.vx = -p.vx; } }
function f(t) { step(rows, 0.02); let e = 0; for (let i = 0; i < rows.length; i++) e += rows[i].x; return Math.floor(e) % 100000; }
const n = +process.argv[2] || 40; let sum = 0; for (let t = 0; t < n; t++) sum = (sum + f(t)) % 1000003; console.log(Math.floor(sum));
