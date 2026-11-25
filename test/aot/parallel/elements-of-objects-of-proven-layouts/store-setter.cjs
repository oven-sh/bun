"use strict";
const log = [];
const outside = JSON.parse('[1, 20, 300]');
const say = value => log.push(typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));
const attempt = run => { try { say(run()); } catch (thrown) { log.push(thrown.constructor.name); } };
const make = v => { const r = { n: v }; r[0] = v; r[1] = v + 1; r[2] = v + 2; return r; };
const show = r => Object.keys(r).join() + "=" + Object.keys(r).map(k => String(r[k])).join();
function setter(v, k) { const r = make(v); Object.defineProperty(r, 1, { set(x) { log.push("set own " + x); }, configurable: true }); r[(k + 1) | 0] = "b"; r[(k + 2) | 0] = "c"; return Object.keys(r).join(); }
for (let turn = 0; turn < 3; turn++) for (const v of outside) { const k = outside.length - 3; attempt(() => setter(v, k)); }
console.log("SAID", log.join(" | "));
