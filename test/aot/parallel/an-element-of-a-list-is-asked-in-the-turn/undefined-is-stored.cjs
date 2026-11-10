"use strict";
const log = globalThis.seen = [];
let seed = 7; function draw(m = 100) { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return Math.round(seed / 0x7fffffff * m * 100) / 100; }
function listOf(n, g) { const l = []; for (let i = 0; i < n; i++) l.push(g(i)); return l; }
const marks = JSON.parse("[" + listOf(60, () => draw()).join() + "]");
function smooth(d, t) { const w = 5 + (t & 3), out = []; let s = 0, ema = d[0]; for (let i = 0; i < d.length; i++) { s += d[i]; if (i >= w) s -= d[i - w]; if (i >= w - 1) out.push(s / w); ema = d[i] * 0.2 + ema * 0.8; } return String(out[t % out.length]).slice(0, 9) + "/" + out.length + "/" + String(ema).slice(0, 9); }
const ways = { smooth, idle(d, t) { return t; } }, steps = JSON.parse('["smooth"]');
function once(t) { return ways[steps[0]](marks, t); }
const change = new Function("list", 'list[20] = undefined;');
let kept = [];
for (let t = 0; t < 300; t++) { if (t === 200) change(marks); try { kept.push(once(t)); } catch (e) { kept.push(e.constructor.name); } }
console.log(kept.slice(196, 212).join(" ")); console.log(kept.slice(-4).join(" ")); console.log(marks.length, log.length, log.slice(0, 8).join(","), log.slice(-3).join(","));
