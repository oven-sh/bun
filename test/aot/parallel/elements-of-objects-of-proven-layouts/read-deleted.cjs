"use strict";
const log = [];
const outside = JSON.parse('[1, 20, 300]');
const say = value => log.push(typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));
const attempt = run => { try { say(run()); } catch (thrown) { log.push(thrown.constructor.name); } };
const make = v => { const r = { n: v }; r[0] = v; r[1] = v + 1; r[2] = v + 2; return r; };
const three = (r, k) => r[k | 0] + "," + r[(k + 1) | 0] + "," + r[(k + 2) | 0] + "," + r[(k + 3) | 0];
function deleted(v, k) { const r = make(v); delete r[1]; return r[k | 0] + "," + r[(k + 1) | 0] + "," + r[(k + 2) | 0]; }
for (let turn = 0; turn < 3; turn++) for (const v of outside) { const k = outside.length - 3; attempt(() => deleted(v, k)); }
console.log("SAID", log.join(" | "));
