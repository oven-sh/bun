"use strict";
const log = [];
const outside = JSON.parse('[1, 2]');
const say = value => log.push(typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));
const attempt = run => { try { say(run()); } catch (thrown) { log.push(thrown.constructor.name + ":" + thrown.message); } };
const a = v => { const r = { x: v }; r[0] = v; r[1] = v + 1; return r; }, b = v => { const r = { y: v, z: v }; r[0] = -v; return r; }; class C { constructor(v) { this.w = v; this[0] = "c" + v; } }
const mixed = []; for (const v of outside) { mixed.push(a(v), b(v), new C(v)); }
function read(t, i) { const r = mixed[t]; return r[i]; } function put(t, i, v) { const r = mixed[t]; r[i] = v; return r[i]; }
for (let t = 0; t < mixed.length; t++) for (let i = 0; i < 3; i++) say(read(t, i)); for (let t = 0; t < mixed.length; t++) say(put(t, 0, t)); for (let t = 0; t < mixed.length; t++) say(read(t, 0));
const pick = t => t % 2 ? a(t) : b(t); function two(t) { const r = pick(t); return r[0] + ":" + r[1]; } for (let t = 0; t < 4; t++) say(two(t));
console.log("SAID", log.join(" | "));
