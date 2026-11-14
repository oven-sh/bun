// Functions read elements and names of arrays through proxies that variables of the file hold, by keys that are written.
// STATISTIC: KnownProxyTrapsCalled >= 6
"use strict";
const log = [];
let calls = 0, at = 99, how = () => {};
const negative = new Proxy([1, 2, 3], { get: (t, q) => (typeof q === "string" && q[0] === "-" ? t[t.length + +q] : t[q]) });
function ends(n) { let s = 0; for (let k = 0; k < n; k++) s += negative[-1] + negative[0]; return s; }
const named = Object.assign([1, 2], { "-1": 7 });
const plain = new Proxy(named, { get(t, q, r) { calls++; return t[q]; } });
function names(n) { let s = 0; for (let k = 0; k < n; k++) s += plain[-1] + plain.length + (plain[5] === undefined ? 1 : 0); return [s, calls]; }
const changed = [1.5, 2.5, 3.5];
const changing = new Proxy(changed, { get(t, q) { if (calls++ === at) how(t, q); return calls > at + 1 ? 9 : t[q]; } });
function fixes(n) { let s = 0; for (let k = 0; k < n; k++) { try { s += changing[0]; } catch (e) { log.push(e.name + " " + e.message); } } return [s, calls]; }
function inSight(n, array, get) { const p = new Proxy(array, { get(t, q) { return get(t, q); } }); let s = 0; for (let k = 0; k < n; k++) s += p[1]; return s; }
const texts = new Proxy(["a", "b"], { get(t, q) { return typeof q + q + t[q]; } });
function says(n) { let s = ""; for (let k = 0; k < n; k++) s += texts[1] + texts[-2] + texts[4294967296]; return s; }
const stored = [1, 2];
const storing = new Proxy(stored, { set(t, q, v) { log.push(typeof q); t[q] = v; return true; } });
function stores(n) { for (let k = 0; k < n; k++) storing.name = k; return [stored.name, Object.keys(stored).join()]; }
for (const n of [0, 1, 3, 9]) console.log(ends(n), String(names(n)), String(fixes(n)), inSight(n, [1, 2], (t, q) => t[q]), says(Math.min(n, 2)), String(stores(n)));
for (const change of [t => Object.freeze(t), (t, q) => Object.defineProperty(t, q, { value: 12, writable: false, configurable: false }), t => { t.length = 0; }, t => t.push({}), t => Object.setPrototypeOf(t, [9, 9]), t => { throw new RangeError("trap"); }]) {
  calls = 0; at = 4; how = change;
  console.log(String(fixes(9)), log.splice(0).join(), attempt(() => inSight(6, Object.freeze([1, 2]), t => t[0])), attempt(() => inSight(6, [1, 2], t => { Object.freeze(t); return 5; })), attempt(() => inSight(6, [1, , 3], (t, q) => t[q])));
}
function attempt(f) { try { return String(f()); } catch (e) { return e.name + ": " + e.message; } }
