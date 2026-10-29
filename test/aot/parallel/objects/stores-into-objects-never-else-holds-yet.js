// `const o = {}; o.a = ..; o.b = ..`: at the top level (run once), in functions, in loops and behind branches. Until the function hands the object on, nobody else can have changed it.
// Each case hands it on, or changes it, at another point: what is stored behind that point has to see the change.
const lines = [];
const describe = object => Reflect.ownKeys(object).map(String).join() + " " + JSON.stringify(Object.getOwnPropertyDescriptors(object), (key, value) => typeof value === "function" ? "function" : typeof value === "symbol" ? String(value) : value) + " " + (Object.isFrozen(object) ? "frozen" : Object.isSealed(object) ? "sealed" : Object.isExtensible(object) ? "open" : "closed");
const attempt = work => { try { return work(); } catch (error) { return error.constructor.name; } };
let seen = [];

const exportsAtTopLevel = {};
exportsAtTopLevel.first = () => 1;
exportsAtTopLevel.second = "two";
exportsAtTopLevel.third = exportsAtTopLevel.first;
exportsAtTopLevel.fourth = 4;
exportsAtTopLevel.second = 2;
exportsAtTopLevel.fifth = [5];
lines.push("top level: " + describe(exportsAtTopLevel));

const cases = {
  plain(i) { const o = {}; o.a = i; o.b = "b"; o.c = [i]; return o; },
  withFields(i) { const o = { a: i, z: 0 }; o.b = i + 1; o.a = "again"; o.c = i + 2; return o; },
  frozenBetween(i) { "use strict"; const o = {}; o.a = i; Object.freeze(o); seen.push(attempt(() => { o.b = i; return "stored"; })); return o; },
  closedBetween(i) { "use strict"; const o = {}; o.a = i; Object.preventExtensions(o); seen.push(attempt(() => { o.b = i; return "stored"; })); o.a = i + 1; return o; },
  handedOn(i, change) { const o = {}; o.a = i; change(o); o.b = i; o.c = i; return o; },
  capturedByClosure(i) { const o = {}; o.a = i; const later = () => Object.defineProperty(o, "b", { value: "defined", writable: false, configurable: true }); later(); o.b = i; o.c = i; return o; },
  storedIntoItself(i) { const o = {}; o.a = i; o.self = o; Object.defineProperty(o.self, "b", { get() { return "getter"; }, set(value) { seen.push("setter " + value); }, configurable: true, enumerable: true }); o.b = i; delete o.self; return o; },
  otherPrototypeByStore(i) { const o = {}; o.a = i; o.__proto__ = { set b(value) { seen.push("inherited setter " + value + " " + (this === o)); }, get c() { return "inherited"; } }; o.b = i; o.c = i; o.d = i; return o; },
  otherPrototypeInLiteral(i) { const o = { __proto__: { set b(value) { seen.push("setter below literal " + value); Object.freeze(this); } }, a: i }; o.b = i; o.c = i; return o; },
  otherPrototypeByCall(i) { const o = {}; o.a = i; Object.setPrototypeOf(o, { set b(value) { seen.push("setter by call " + value); } }); o.b = i; o.c = i; return o; },
  deletedBetween(i) { const o = {}; o.a = i; o.b = i; delete o.a; o.c = i; o.a = "back"; return o; },
  sameNameOtherTypes(i) { const o = {}; o.a = i; o.a = "text"; o.a = { i }; o.b = 1.5; o.b = i; return o; },
  computedBetween(i, change, key) { const o = {}; o.a = i; o[key] = "computed"; o.b = i; o.c = i; return o; },
  accessorBetween(i) { const o = {}; o.a = i; Object.defineProperty(o, "c", { get() { return "getter"; }, configurable: true }); o.b = i; seen.push(attempt(() => { "use strict"; o.c = i; return "stored"; })); return o; },
  behindBranches(i) { const o = {}; if (i & 1) o.a = i; else o.b = i; o.c = i; if (i & 2) { o.a = "late"; Object.freeze(o); } o.d = i; return o; },
  allocatedOutsideLoop(i, change) { const o = {}; for (let k = 0; k < 3; k++) { o.a = k; o["b" + k] = k; o.c = k; if (k === 1) change(o); } return o; },
  allocatedInsideLoop(i, change) { let last; for (let k = 0; k < 3; k++) { const o = {}; o.a = k; o.b = i; if (k === 1) change(o); o.c = k; last = o; } return last; },
  readBetween(i) { const o = { get twice() { seen.push("getter ran"); Object.freeze(this); return 2; } }; o.a = i; o.b = o.twice; o.c = i; return o; },
  thrownBetween(i) { const o = {}; o.a = i; try { o.b = (() => { throw o; })(); } catch (thrown) { Object.freeze(thrown); } o.c = i; return o; },
  yielded: i => { function* g() { const o = {}; o.a = i; const sent = yield o; o.b = sent; o.c = i; return o; } const it = g(); Object.freeze(it.next().value); return it.next("sent").value; },
  symbolsAndNumbers(i) { const o = {}; o.a = i; o[Symbol.iterator] = i; o[0] = i; o.b = i; o["1"] = i; return o; },
  classInstance(i) { class C { constructor() { this.a = i; this.b = i; } set c(value) { seen.push("class setter " + value); } } const o = new C(); o.c = i; o.d = i; return o; },
  nullPrototype(i) { const o = Object.create(null); o.a = i; o.b = i; return o; },
};
const changes = [o => {}, o => Object.freeze(o), o => Object.defineProperty(o, "b", { value: "fixed", writable: false, enumerable: true }), o => { o.b = "early"; o.z = 1; }, o => Object.setPrototypeOf(o, { set c(value) { seen.push("late setter " + value); } }), o => delete o.a];
for (const [label, make] of Object.entries(cases)) {
  for (let which = 0; which < changes.length; which++) {
    seen = [];
    let last;
    for (let i = 0; i < 6; i++) last = attempt(() => make(i, changes[which], ["b", "c", "x", "a"][i & 3]));
    lines.push(label + " " + which + ": " + (typeof last === "object" ? describe(last) : last) + " | " + seen.join());
    if (make.length < 2) break;
  }
}
console.log(lines.join("\n"));
