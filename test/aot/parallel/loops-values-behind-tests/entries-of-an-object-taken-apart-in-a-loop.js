// `for (const [key, value] of Object.entries(object))`: nobody gets hold of the list or of a pair, so neither is made: the keys and values lie one behind the other in one list.
// What the program can see stays: the keys and values are read once, in order, in front of the first turn, getters run then, and what a turn does to the object changes nothing that the loop hands out.
const say = value => console.log(String(value));
function tell(f) { try { say(f()); } catch (thrown) { say(thrown.name); } }
function listed(o) { let s = ""; for (const [key, value] of Object.entries(o)) s += key + "=" + String(value) + ";"; return s; }
function left(o) { let s = ""; for (const [key, value] of Object.entries(o)) { if (key === "c") break; if (key === "a") continue; s += key + String(value); } return s; }
function changed(o) { let s = ""; for (const [key, value] of Object.entries(o)) { s += key + String(value); delete o.b; o.z = 26; o.c = "new"; } return s + Object.keys(o).join(); }
function assigned(o) { let s = ""; for (let [key, value] of Object.entries(o)) { key += "!"; value = [value]; s += key + value.length; } return s; }
function walked(x, path, out) { if (Array.isArray(x)) { x.forEach((v, i) => walked(v, [...path, i], out)); return; } if (x !== null && typeof x === "object") { for (const [key, value] of Object.entries(x)) { if (key === "stop") out.push({ path, value }); else walked(value, [...path, key], out); } } }
function thrown(o) { let s = ""; try { for (const [key, value] of Object.entries(o)) { s += key; if (value === 2) throw new Error("stop"); } } catch (error) { s += "!"; } return s; }
function captured(o) { const all = []; for (const [key, value] of Object.entries(o)) all.push(() => key + String(value)); return all.map(f => f()).join(); }
function nested(o) { let s = ""; for (const [key, value] of Object.entries(o)) for (const [inner, deep] of Object.entries(value)) s += key + inner + String(deep); return s; }
function withDefaults(o) { let s = ""; for (const [key, value = "none"] of Object.entries(o)) s += key + String(value); return s; }
function pairKept(o) { const kept = []; for (const pair of Object.entries(o)) { const [key, value] = pair; kept.push(pair); s0 += key + String(value); } return kept.length + ":" + kept.map(p => p.join("-")).join(); }
let s0 = "";
function listKept(o) { const list = Object.entries(o); let s = ""; for (const [key, value] of list) s += key + String(value); return s + list.length; }
function onlyKeys(o) { let s = ""; for (const [key] of Object.entries(o)) s += key; return s; }
function three(o) { let s = ""; for (const [key, value, more] of Object.entries(o)) s += key + String(value) + String(more); return s; }
class Point { constructor(x, y) { this.x = x; this.y = y; } get sum() { return this.x + this.y; } }
let reads = 0;
const withGetter = { a: 1, get b() { reads++; return reads * 10; }, c: 3 };
const hidden = Object.defineProperty({ a: 1, c: 3 }, "b", { value: 2, enumerable: false });
const keyed = { 2: "two", b: "bee", 1: "one", [Symbol("s")]: "no", a: "ay" };
const everything = () => [{}, { a: 1 }, { a: 1, b: 2, c: 3, d: 4 }, new Point(3, 4), withGetter, hidden, keyed, [7, 8], "xy", 5, true, Object.create({ above: 1 }), Object.assign(Object.create(null), { n: 0 }), new Map([["m", 1]]), JSON.parse('{"j":[1,{"stop":2}],"k":null}'), new Proxy({ p: 1, q: 2 }, { ownKeys: t => (say("ownKeys"), Reflect.ownKeys(t)), get: (t, k) => (say("get " + String(k)), t[k]) }), Object.freeze({ f: 1 }), function named() {}, null, undefined];
[listed, left, assigned, thrown, captured, withDefaults, pairKept, listKept, onlyKeys, three].forEach(f => everything().forEach(o => tell(() => f(o))));
say(reads); say(s0);
tell(() => changed({ a: 1, b: 2, c: 3 })); tell(() => changed(new Point(1, 2)));
tell(() => nested({ u: { a: 1 }, v: { b: 2, c: 3 }, w: [] })); tell(() => nested({ u: null }));
const out = []; walked({ a: [1, { stop: "first" }], b: { c: { stop: "second", d: 4 } }, stop: 0 }, [], out); say(JSON.stringify(out));
