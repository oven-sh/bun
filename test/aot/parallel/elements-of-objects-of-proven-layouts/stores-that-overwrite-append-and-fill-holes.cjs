"use strict";
const log = [];
const outside = JSON.parse('[0, 1.5, "s"]');
const say = value => log.push(typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));
const attempt = run => { try { say(run()); } catch (thrown) { log.push(thrown.constructor.name + ":" + thrown.message); } };
class Ring { constructor() { this.n = 8; } } const rings = []; for (const v of outside) { const r = new Ring(); for (let i = 0; i < 4; i++) r[i] = v; rings.push(r); }
function put(t, i, v) { const r = rings[t]; r[i | 0] = v; return r[i | 0]; } function putUnder(t, i, v) { const r = rings[t]; r[i] = v; return r[i]; }
const show = t => { const r = rings[t]; return Object.keys(r).join() + "=" + Object.values(r).map(String).join(); };
for (let t = 0; t < rings.length; t++) { say(put(t, 0, 7)); say(put(t, 1, 2.5)); say(put(t, 2, "text")); say(put(t, 3, { k: t })); say(put(t, 4, 44)); say(put(t, 9, 99)); say(put(t, 6, null)); say(show(t)); }
for (const key of [-1, 1.5, "2", 4294967295]) say(putUnder(0, key, "k" + key)); say(show(0));
function fillAll(t) { const r = rings[t]; for (let i = 0; i < 100; i++) r[i & 3] = i; return r[0] + r[1] + r[2] + r[3]; } for (let t = 0; t < rings.length; t++) say(fillAll(t));
attempt(() => put(7, 0, 1));
console.log("SAID", log.join(" | "));
