// STATISTIC: KeyedPlacesAskedInline >= 5
// Stores and reads under unknown keys in loops, on fresh records and on objects that setters, freezing, deletion, proxies and other shapes change.
"use strict";
const words = (process.env.WORDS ?? "a b a c d a e b zz 7 length a constructor toString x y z a").split(" ");
let heard = "";
class Plain { a = 1; b = 0.5; }
class Heir extends Plain { c = null; set d(value) { heard += "d"; } }
function count(list) { const r = {}; for (const w of list) r[w] = (r[w] || 0) + 1; return r; }
function group(list, keyOf) { const r = {}; for (const one of list) { const key = keyOf(one); const g = r[key]; if (g) g.push(one); else r[key] = [one]; } return r; }
function index(list, target) { for (let i = 0; i < list.length; i++) target[list[i]] = i; return target; }
function fill(target, list, values) { let same = 0; for (let i = 0; i < list.length; i++) { const key = list[i], before = target[key]; target[key] = values[i % values.length]; if (target[key] === before) same++; } return same; }
function sloppy(target, list) { return new Function("target", "list", "for (const key of list) target[key] = target[key] + 1; return target")(target, list); }
function big(n) { const o = {}; for (let i = 0; i < n; i++) o["k" + i] = i; return o; }
const show = value => typeof value === "object" && value ? (Array.isArray(value) ? "[" + value.length + "]" : "{}") : typeof value === "function" ? "f" : Object.is(value, -0) ? "-0" : String(value);
const look = object => Object.keys(object).map(key => key + "=" + show(object[key])).join();
const keys = [...words, ...words.map(w => w + ""), "k1", "k5", "k90", 3, 1.5, null, Symbol.iterator];
const makers = [() => ({}), () => ({ a: 1, x: 2 }), () => Object.create(null), () => new Plain, () => new Heir, () => [], () => Object.freeze({ a: 1 }), () => Object.create({ a: 3, set b(v) { heard += "b"; } }),
  () => new Proxy({}, { set(t, k, v) { heard += "p"; t[k] = v; return true; } }), () => big(8), () => big(40), () => big(130), () => { const o = big(12); delete o.k3; return o; }, () => ({ get c() { return 5; }, set c(v) { heard += "c"; } }), () => function () {}, () => new Map, () => new Uint8Array(9), () => Object.create(Object.freeze({ zz: 1 }))];
for (let turn = 0; turn < 60; turn++) {
  for (const make of makers) {
    const target = make(), values = turn % 3 === 0 ? [1, 2] : turn % 3 === 1 ? ["s", { turn }, undefined] : [0.5, -0, null, [turn]];
    let text = "";
    try { text += fill(target, keys, values); } catch (error) { text += error.constructor.name; }
    if (turn % 9 === 4) { try { Object.defineProperty(target, "a", { get() { return 8; }, set(v) { heard += "s"; }, configurable: true }); text += fill(target, words, values); } catch (error) { text += error.constructor.name; } }
    if (turn % 9 === 5) { Object.preventExtensions(target); try { text += fill(target, ["new1", "a"], values); } catch (error) { text += error.constructor.name; } }
    if (turn % 9 === 6) { try { delete target.b; index(words, target); } catch (error) { text += error.constructor.name; } }
    if (turn % 20 === 19) console.log(text, look(target).slice(0, 90));
  }
  if (turn % 20 === 7) console.log(look(count(words)), look(group(words, w => w.length)), look(index(words, {})), look(sloppy({ a: 1, b: "t" }, ["a", "b", "q"])), heard.length, heard.slice(-20));
}
