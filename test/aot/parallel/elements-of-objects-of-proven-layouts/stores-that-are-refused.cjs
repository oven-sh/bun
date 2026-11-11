"use strict";
const log = [];
const outside = JSON.parse('[10, 20, 30, 40, 50, 60]');
const say = value => log.push(typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));
const attempt = run => { try { say(run()); } catch (thrown) { log.push(thrown.constructor.name + ":" + thrown.message); } };
const make = v => { const r = { n: v }; for (let i = 0; i < 3; i++) r[i] = v + i; return r; }; const all = outside.map(make);
Object.freeze(all[0]); Object.seal(all[1]); Object.preventExtensions(all[2]); Object.defineProperty(all[3], 1, { writable: false }); Object.defineProperty(all[4], 1, { set(v) { log.push("set " + v); }, configurable: true });
function put(t, i, v) { const r = all[t]; r[i | 0] = v; return r[i | 0]; }
for (let t = 0; t < all.length; t++) for (const i of [0, 1, 2, 3]) attempt(() => put(t, i, 70 + i));
for (const r of all) say(Object.keys(r).join() + "=" + Object.keys(r).map(k => { try { return String(r[k]); } catch { return "!"; } }).join());
class Above { } Object.defineProperty(Above.prototype, 2, { set(v) { log.push("above set " + v); }, get() { return "above"; }, configurable: true }); Object.defineProperty(Above.prototype, 3, { value: "fixed", writable: false });
class Below extends Above { constructor() { super(); this.n = 1; } } const lows = [new Below(), new Below()]; lows[0][0] = 1; lows[1][0] = 1; lows[1][2] = "never";
function low(t, i, v) { const r = lows[t]; r[i | 0] = v; return r[i | 0]; } for (let t = 0; t < 2; t++) for (const i of [0, 1, 2, 3]) attempt(() => low(t, i, "v" + i));
console.log("SAID", log.join(" | "));
