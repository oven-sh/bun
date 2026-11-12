"use strict";
const log = [];
const outside = JSON.parse('[1, 20, 300]');
const say = value => log.push(typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));
const attempt = run => { try { say(run()); } catch (thrown) { log.push(thrown.constructor.name); } };
const make = v => { const r = { n: v }; r[0] = v; r[1] = v + 1; r[2] = v + 2; return r; };
class Above { } Above.prototype[1] = "above"; Object.defineProperty(Above.prototype, 2, { get() { return "got"; }, configurable: true }); class Below extends Above { constructor(v) { super(); this.n = v; this[0] = v; } }
const three = (r, k) => r[k | 0] + "," + r[(k + 1) | 0] + "," + r[(k + 2) | 0] + "," + r[(k + 3) | 0];
function belowOwn(v, k) { const r = new Below(v); r[1] = "own"; r[2] = "hidden by the getter?"; return r[k | 0] + "," + r[(k + 1) | 0] + "," + r[(k + 2) | 0]; }
for (let turn = 0; turn < 3; turn++) for (const v of outside) { const k = outside.length - 3; attempt(() => belowOwn(v, k)); }
console.log("SAID", log.join(" | "));
