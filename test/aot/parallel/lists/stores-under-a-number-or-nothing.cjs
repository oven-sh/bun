// Lists and views of every kind stored into under numbers, nothing, true and false, and read back by every road.
"use strict";
const out = [], J = JSON.parse;
class C { constructor(x) { this.x = x; this.y = x * 2; } sum() { return this.x + this.y; } }
const ks = [0, 1, 5, -1, 1.5, NaN, Infinity, undefined, null, true, false, -0, 4294967295];
const say = v => out.push(v instanceof C ? "C" + v.sum() : typeof v === "object" && v ? "[" + Object.keys(v).join() + "]" : String(v));
const lists = () => [[new C(1), new C(2)], [1, 2], [0.5, 1.5], ["a"], [], [, new C(3)], new Uint8Array(3), new Float64Array(2), Object.freeze([new C(4)]), Object.seal([new C(5)]), new Array(3), [null]];
const T = { store(l, k, v) { l[k] = v; return l[k]; }, get(l, m, v) { const at = m.get("k"); if (at !== undefined) l[at] = v; return at === undefined ? "none" : l[at]; }, chained(l, o, v) { const at = o?.at; l[at] = v; return l[at]; }, list(l, p, v) { for (let i = 0; i < p.length; i++) l[p[i]] = v; return l.length; }, pop(l, s, v) { const at = s.pop(); l[at] = v; return l[at]; }, has(l, k) { return k in l; } };
const names = Object.keys(T).map(x => J(JSON.stringify(x)));
for (let r = 0; r < 3; r++) { out.length = 0;
  for (const k of ks) for (const l of lists()) for (const v of [new C(7), 3, 0.5, "t", null]) { const a = { store: [l, k, v], get: [l, new Map([["k", k]]), v], chained: [l, k === undefined ? undefined : { at: k }, v], list: [l, [0, k], v], pop: [l, [k], v], has: [l, k] }; for (const n of names) { try { say(T[n](...a[n])); } catch (e) { out.push(e.name); } } say(l.undefined); say(l["null"]); say(l[true]); say(l["1.5"]); say(l[r > 5 ? 0 : undefined]); out.push(l.length, Object.keys(l).length); let s = ""; for (const n in l) s += n + ","; out.push(s); if (Array.isArray(l) && !Object.isFrozen(l) && Object.isExtensible(l)) { l.push(v); say(l[l.length - 1]); say(l.pop()); } }
  class P { set undefined(v) { out.push("set"); } } class Q extends P { put(k, v) { super[k] = v; return this[k]; } } for (const k of ks) { const q = new Q(); try { say(q.put(k, new C(9))); } catch (e) { out.push(e.name); } } }
let h = 0; const text = out.join(); for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0; console.log(h, out.length, out.slice(0, 60).join("|"));
