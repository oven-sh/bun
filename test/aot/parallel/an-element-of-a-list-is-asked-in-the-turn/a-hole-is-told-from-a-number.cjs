"use strict";
const log = globalThis.seen = [];
let seed = 7; function draw(m = 100) { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return Math.round(seed / 0x7fffffff * m * 100) / 100; }
function listOf(n, g) { const l = []; for (let i = 0; i < n; i++) l.push(g(i)); return l; }
const marks = JSON.parse("[" + listOf(60, () => draw()).join() + "]");
function tell(d, t) { let s = 0, gaps = 0, out = []; for (let i = 0; i < d.length; i++) { const x = d[i]; if (x === undefined) { gaps++; out.push(i); } else s += x; } return String(s).slice(0, 9) + "/" + gaps + "/" + out.slice(0, 4).join("."); }
const ways = { tell, idle(d, t) { return t; } }, steps = JSON.parse('["tell"]');
function once(t) { return ways[steps[0]](marks, t); }
const change = new Function("list", 'delete list[17]; delete list[40];');
let kept = [];
for (let t = 0; t < 300; t++) { if (t === 200) change(marks); try { kept.push(once(t)); } catch (e) { kept.push(e.constructor.name); } }
console.log(kept.slice(197, 204).join(" ")); console.log(kept.slice(-2).join(" ")); console.log(marks.length, log.length, log.slice(0, 8).join(","));
