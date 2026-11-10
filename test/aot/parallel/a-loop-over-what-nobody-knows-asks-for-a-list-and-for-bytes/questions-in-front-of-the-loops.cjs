// STATISTIC: LoopsBuiltForListsAndForBytes >= 7
// Functions ask of their parameter whether it is there, what it is and how long it is, in front of a loop over it.
"use strict";
const out = [], names = JSON.parse('["truth","nullish","kind","list","none","empty","class","same","turned"]');
const L = "let s = 0; for (let i = 0; i < d.length; i++) s = (s + d[i]) | 0; return s;";
const methods = {
  truth(d) { if (!d) return "no"; let s = 0; for (let i = 0; i < d.length; i++) s = (s + d[i]) | 0; return s; },
  nullish(d) { if (d == null) return "null"; let s = 0; for (let i = 0; i < d.length; i++) s = (s + d[i]) | 0; return s; },
  kind(d) { if (typeof d !== "object") return typeof d; let s = 0; for (let i = 0; i < d.length; i++) s = (s + d[i]) | 0; return s; },
  list(d) { const a = Array.isArray(d); let s = 0; for (let i = 0; i < d.length; i++) s = (s + d[i]) | 0; return a + "/" + s; },
  none(d) { if (d.length === 0) return "empty"; let s = 0; for (let i = 0; i < d.length; i++) s = (s + d[i]) | 0; return s; },
  empty(d) { if (!d.length) return "nothing"; let s = 0; for (let i = 0; i < d.length; i++) s = (s + d[i]) | 0; return s; },
  class(d) { if (!(d instanceof Uint8Array)) return "other"; let s = 0; for (let i = 0; i < d.length; i++) s = (s + d[i]) | 0; return s; },
  same(d) { if (d === methods) return "me"; let s = 0; for (let i = 0; i < d.length; i++) s = (s + d[i]) | 0; return s; },
  turned(d) { switch (typeof d) { case "string": return "text"; case "number": return "number"; } let s = 0; for (let i = 0; i < d.length; i++) s = (s + d[i]) | 0; return s; },
};
const given = [[1, 2, 3], [1.5, -0], [], [1, , 3], ["4", null], [5n], new Uint8Array([1, 2, 250]), Buffer.from([4, 5]), new Float64Array([0.5, 1.5]), new Uint8Array(0), "12", "", 0, 7, true, null, undefined, { length: 2, 0: 5, 1: 6 }, { get length() { out.push("length"); return 1; }, get 0() { out.push("0"); return 3; } }, { valueOf() { out.push("valueOf"); return 0; }, length: 1, 0: 2 }, new Proxy([1, 2], {}), Symbol("s"), methods, function (a, b) {}, new (class extends Uint8Array { get length() { return 1; } })(3)];
class Odd { static [Symbol.hasInstance](v) { out.push("asked"); return !!v; } }
const odd = d => { if (!(d instanceof Odd)) return "odd"; let s = 0; for (let i = 0; i < d.length; i++) s = (s + d[i]) | 0; return s; };
for (let r = 0; r < 30; r++) { out.length = 0; for (const name of names) for (const d of given) { try { out.push(String(methods[name](d))); } catch (e) { out.push(e.name); } } for (const d of given) { try { out.push(String(odd(d))); } catch (e) { out.push(e.name); } } }
console.log(out.join("|"), L.length);
