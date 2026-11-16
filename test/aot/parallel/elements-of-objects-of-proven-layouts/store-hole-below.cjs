"use strict";
const log = [];
const outside = JSON.parse('[1, 20, 300]');
const say = value => log.push(typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));
const attempt = run => { try { say(run()); } catch (thrown) { log.push(thrown.constructor.name); } };
const make = v => { const r = { n: v }; r[0] = v; r[1] = v + 1; r[2] = v + 2; return r; };
class Above { } Object.defineProperty(Above.prototype, 1, { set(x) { log.push("set above " + x); }, get() { return "above"; }, configurable: true }); Object.defineProperty(Above.prototype, 2, { value: "fixed", writable: false }); class Below extends Above { constructor(v) { super(); this.n = v; this[0] = v; } }
const show = r => Object.keys(r).join() + "=" + Object.keys(r).map(k => String(r[k])).join();
function holeBelow(v, k) { const r = new Below(v); r[3] = "three"; try { r[(k + 1) | 0] = "to the setter"; r[(k + 2) | 0] = "refused"; } catch (thrown) { log.push(thrown.constructor.name); } return show(r); }
for (let turn = 0; turn < 3; turn++) for (const v of outside) { const k = outside.length - 3; attempt(() => holeBelow(v, k)); }
console.log("SAID", log.join(" | "));
