"use strict";
const log = [];
const outside = JSON.parse('[1, 20, 300]');
const say = value => log.push(typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));
const attempt = run => { try { say(run()); } catch (thrown) { log.push(thrown.constructor.name); } };
const make = v => { const r = { n: v }; r[0] = v; r[1] = v + 1; r[2] = v + 2; return r; };
const show = r => Object.keys(r).join() + "=" + Object.keys(r).map(k => String(r[k])).join();
function negative(v, k) { const r = make(v); r[(k - 1) | 0] = "minus"; return show(r); }
for (let turn = 0; turn < 3; turn++) for (const v of outside) { const k = outside.length - 3; attempt(() => negative(v, k)); }
console.log("SAID", log.join(" | "));
