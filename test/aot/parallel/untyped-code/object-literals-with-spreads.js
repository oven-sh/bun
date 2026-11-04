// Object literals that mix written names and spreads: the order of keys, which member wins, when each source is read, what a source may be, and what a stack trace shows when a getter of a source throws.
const log = [];
const note = (text, value) => { log.push(text); return value; };
const show = value => JSON.stringify(value, (key, held) => typeof held === "function" ? "function" : typeof held === "symbol" ? String(held) : held === undefined ? "undefined" : typeof held === "bigint" ? held + "n" : held);
const describe = object => Reflect.ownKeys(object).map(key => { const d = Object.getOwnPropertyDescriptor(object, key); return String(key) + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : "") + ("value" in d ? "=" + show(d.value) : "accessor"); }).join(" ");
function say(name, make) { let text; try { const made = make(); text = describe(made) + " | " + (Object.getPrototypeOf(made) === Object.prototype) + " " + Object.isExtensible(made); } catch (e) { text = "threw " + (e && e.name) + ": " + (e && e.message); } console.log(name + ": " + text + (log.length ? " | " + log.splice(0).join(",") : "")); }

function oneThenSpread(r, i) { return { g: i, ...r }; }
function twoThenSpread(r, i) { return { g: i, h: i + 1, ...r }; }
function spreadThenOne(r, i) { return { ...r, g: i }; }
function twoSpreads(r, s) { return { ...r, ...s }; }
function threeSpreads(r, s, t) { return { ...r, ...s, ...t }; }
function fourSpreads(r, s, t, u) { return { ...r, ...s, ...t, ...u }; }
function between(r, s, i) { return { a: i, ...r, b: i, ...s, c: i }; }
function sameNameAround(r, i) { return { a: i, ...r, a: i + 1 }; }
function sameNameTwiceAhead(r, i) { return { a: i, a: i + 1, ...r }; }
function closuresAndArrays(r, i) { return { ...r, f: () => i, l: [i, i], n: null, u: undefined, t: true, d: 1.5, s: "text" }; }
function callAhead(r) { return { a: note("a", 1), ...note("r", r), b: 2 }; }
function callBehind(r, change) { return { ...r, a: change(r), b: 2 }; }
function callBetweenSpreads(r, s, change) { return { x: 0, ...r, a: change(r, s), ...s }; }
function readBehind(r, other) { return { ...r, a: other.value, ...r }; }
function nested(r, s, i) { return { ...r, inner: { ...s, i }, last: i }; }
function manyNames(r) { return { a1: 1, a2: 2, a3: 3, a4: 4, a5: 5, a6: 6, a7: 7, a8: 8, a9: 9, a10: 10, a11: 11, a12: 12, ...r }; }
function storedLater(r, i) { const o = { g: i, ...r }; o.later = i; o.more = i; return o; }
function definedLater(r, f) { return { g: 1, ...r, h: f(), i: 2, j: 3, k: 4 }; }
function withGetterInLiteral(r) { return { get g() { return 1; }, ...r }; }
function withComputed(r, k) { return { [k]: 1, ...r, z: 2 }; }
function withProto(r, p) { return { __proto__: p, a: 1, ...r }; }
function withIndex(r) { return { 1: "one", ...r, 0: "zero" }; }
function conditional(r, c) { return { a: 1, ...(c ? r : null), b: 2 }; }
function logicalAnd(r, c) { return { a: 1, ...(c && r), b: 2 }; }
function inTry(r, s) { try { return { a: 1, ...r, ...s }; } catch (e) { return { caught: String(e) }; } }

const plain = { a: "A", b: "B", c: "C" }, other = { x: 1, y: 2 }, overlapping = { b: "b2", z: 26, a: "a2" };
const sources = {
  plain, other, overlapping, empty: {}, undefined: undefined, null: null, false: false, true: true, zero: 0, number: 5, bigint: 10n, symbol: Symbol("s"), text: "hi", emptyText: "",
  array: ["p", "q"], holey: [, "q"], fn: Object.assign(function () {}, { own: 1 }), date: new Date(0), map: new Map([[1, 2]]),
  hidden: Object.defineProperty({ a: 1, c: 3 }, "b", { value: 2, enumerable: false }), readOnly: Object.freeze({ a: 1, b: 2 }), sealed: Object.seal({ a: 1 }),
  getter: { a: 1, get b() { return note("get b", 2); }, c: 3 }, setterOnly: { a: 1, set b(v) {} },
  symbolKey: { a: 1, [Symbol.for("k")]: 2, b: 3 }, hiddenSymbol: Object.defineProperty({ a: 1 }, Symbol.for("h"), { value: 1, enumerable: false }),
  protoKey: JSON.parse('{"__proto__": {"polluted": true}, "a": 1}'), indexed: { b: 1, 2: "two", a: 2, 0: "zero" }, inherited: Object.assign(Object.create({ up: 1 }), { own: 2 }),
  nullPrototype: Object.assign(Object.create(null), { a: 1, b: 2 }), instance: new (class K { constructor() { this.x = 1; this.y = 2; } m() {} get v() { return 1; } })(),
  withPrivate: new (class P { #p = 1; q = 2; })(), deleted: (() => { const o = { a: 1, b: 2, c: 3 }; delete o.b; o.d = 4; o.b = 5; return o; })(),
  dictionary: (() => { const o = {}; for (let i = 0; i < 200; i++) o["k" + i] = i; for (let i = 0; i < 196; i++) delete o["k" + i]; return o; })(),
  seventy: (() => { const o = {}; for (let i = 0; i < 70; i++) o["p" + i] = i; return o; })(), outOfLine: (() => { const o = { a: 1 }; for (let i = 0; i < 12; i++) o["q" + i] = i; return o; })(),
  proxy: new Proxy({ a: 1, b: 2 }, { ownKeys(t) { note("ownKeys"); return Reflect.ownKeys(t); }, getOwnPropertyDescriptor(t, k) { note("gopd " + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); }, get(t, k) { note("get " + String(k)); return t[k]; } }),
  parsed: JSON.parse('{"a":1,"n":{"m":2},"l":[3]}'), args: (function () { return arguments; })(7, 8), boxed: new String("ab"), then: { then: 1, a: 2 },
};
for (const name of Object.keys(sources)) {
  const r = sources[name];
  for (let round = 0; round < 2; round++) {
    say("oneThenSpread " + name, () => oneThenSpread(r, round));
    say("twoThenSpread " + name, () => twoThenSpread(r, round));
    say("spreadThenOne " + name, () => spreadThenOne(r, round));
    say("twoSpreads plain, " + name, () => twoSpreads(plain, r));
    say("twoSpreads " + name + ", overlapping", () => twoSpreads(r, overlapping));
    say("threeSpreads " + name, () => threeSpreads(other, r, overlapping));
    say("fourSpreads " + name, () => fourSpreads(other, r, overlapping, r));
    say("between " + name, () => between(r, overlapping, round));
    say("sameNameAround " + name, () => sameNameAround(r, round));
    say("sameNameTwiceAhead " + name, () => sameNameTwiceAhead(r, round));
    say("closuresAndArrays " + name, () => closuresAndArrays(r, round));
    say("callAhead " + name, () => callAhead(r));
    say("nested " + name, () => nested(r, r, round));
    say("manyNames " + name, () => manyNames(r));
    say("storedLater " + name, () => storedLater(r, round));
    say("definedLater " + name, () => definedLater(r, () => note("f", 9)));
    say("withGetterInLiteral " + name, () => withGetterInLiteral(r));
    say("withComputed " + name, () => withComputed(r, "a"));
    say("withProto " + name, () => Object.assign({ proto: Object.getPrototypeOf(withProto(r, plain)) === plain }, withProto(r, plain)));
    say("withIndex " + name, () => withIndex(r));
    say("conditional " + name, () => conditional(r, round));
    say("logicalAnd " + name, () => logicalAnd(r, round));
    say("inTry " + name, () => inTry(r, r));
  }
}
say("a source changed by a later member", () => callBehind({ a: 1, b: 1, c: 1 }, r => { r.c = "changed"; r.d = "added"; delete r.b; return "called"; }));
say("sources changed between two spreads", () => callBetweenSpreads({ p: 1 }, { q: 1 }, (r, s) => { r.p = "late"; s.q = "in time"; s.added = true; return "called"; }));
say("a getter that changes what is read behind it", () => { const box = { value: "before" }; return readBehind({ get g() { box.value = "after"; return 1; } }, box); });
say("a getter that changes the next source", () => { const s = { q: "before" }; return twoSpreads({ get g() { s.q = "after"; s.r = "new"; return 1; } }, s); });
say("a getter that changes its own object", () => oneThenSpread({ a: 1, get b() { delete this.c; this.d = 4; return 2; }, c: 3 }, 0));
say("the same object twice", () => twoSpreads(plain, plain));
const thrower = { a: 1, get b() { throw new RangeError("from the getter"); }, c: 3 };
for (const [name, make] of Object.entries({ first: () => twoSpreads(thrower, note("not reached?", plain)), second: () => twoSpreads(plain, thrower), ahead: () => oneThenSpread(thrower, 1), third: () => threeSpreads(plain, other, thrower), between: () => between(plain, thrower, 1) }))
  say("a getter throws, " + name, make);
function positions(r,
  s) {
  return {
    a: 1,
    ...r,
    b: 2,
    ...s,
  };
}
for (const [r, s] of [[thrower, plain], [plain, thrower]]) {
  try { positions(r, s); } catch (e) { console.log("stack:", e.message, String(e.stack).split("\n").filter(line => /positions/.test(line)).length); }
}
const shapes = [];
for (let i = 0; i < 40; i++) { const o = {}; for (let j = 0; j <= i % 13; j++) o["n" + ((i * 7 + j) % 17)] = j; shapes.push(o); }
let sum = 0;
for (let round = 0; round < 300; round++) for (const o of shapes) { const made = between(o, shapes[(round + 3) % shapes.length], round); sum += Object.keys(made).length + made.c; }
console.log("many shapes:", sum);
const kept = [];
for (let i = 0; i < 60000; i++) { const made = twoThenSpread({ p: i, q: { i }, r: "t" + i }, i); if (i % 10000 === 0) kept.push(made, twoSpreads(made, { extra: [i] })); }
(globalThis.gc ?? (() => globalThis.Bun.gc(true)))();
console.log(show(kept));
const grown = oneThenSpread(plain, 1); for (let i = 0; i < 20; i++) grown["more" + i] = i; delete grown.a; grown.a = "again";
console.log(describe(grown));
