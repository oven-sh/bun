// Object.defineProperty() with a descriptor literal on a newly created function: data properties, accessors, symbols, the built-in name, length and prototype properties, classes, and non-extensible, frozen or already-defined cases.
const lines = [];
const describe = (o, k) => { const d = Object.getOwnPropertyDescriptor(o, k); if (!d) return "none"; return "get" in d || "set" in d ? ["accessor", typeof d.get, typeof d.set, d.enumerable, d.configurable].join() : [typeof d.value === "function" ? "function" : typeof d.value === "object" && d.value ? "object" : String(d.value), d.writable, d.enumerable, d.configurable].join(); };
function constructorOf(name, initializer) {
  function init(inst, def) { inst.def = def; initializer(inst, def); }
  function _(def) { const inst = this; init(inst, def); return inst; }
  Object.defineProperty(_, "init", { value: init });
  Object.defineProperty(_, Symbol.hasInstance, { value: inst => inst?.traits?.has(name) === true });
  Object.defineProperty(_, "name", { value: name });
  return _;
}
let sum = 0; const kept = [];
for (let i = 0; i < 1500; i++) { const K = constructorOf("K" + (i % 7), inst => { inst.traits = new Set(["K" + (i % 7)]); }); const o = new K(i); sum += o.def + K.name.length + (o instanceof K ? 1 : 0) + Reflect.ownKeys(K).length; if (i < 2) kept.push(K); }
lines.push("constructors " + sum);
for (const K of kept) lines.push(Reflect.ownKeys(K).map(String).join() + " | " + ["init", Symbol.hasInstance, "name", "length", "prototype"].map(k => describe(K, k)).join(" | "));
function dressed(i) {
  const f = () => i;
  Object.defineProperty(f, "shown", { value: i, writable: true, enumerable: true, configurable: true });
  Object.defineProperty(f, "lazy", { get() { return i + 1; }, configurable: true });
  Object.defineProperty(f, "both", { get() { return i + 2; }, set(v) { this.shown = v; }, enumerable: true });
  Object.defineProperty(f, "fourth", { value: 4 }); Object.defineProperty(f, "fifth", { value: 5, enumerable: true }); Object.defineProperty(f, "sixth", { enumerable: true });
  return f;
}
let total = 0; for (let i = 0; i < 1500; i++) { const f = dressed(i); f.both = i + 3; total += f.shown + f.lazy + f.both + f.fourth + f.fifth + Object.keys(f).length + f(); }
lines.push("dressed " + total + " " + Reflect.ownKeys(dressed(1)).join() + " | " + ["shown", "lazy", "both", "fourth", "fifth", "sixth"].map(k => describe(dressed(1), k)).join(" | "));
const attempt = f => { try { return String(f()); } catch (e) { return e.constructor.name; } };
for (let i = 0; i < 3; i++) {
  lines.push(attempt(() => describe(Object.defineProperty(function () {}, "length", { value: 9 }), "length")) + " " + attempt(() => describe(Object.defineProperty(() => 1, "name", { value: "renamed", writable: true }), "name")) + " " + attempt(() => describe(Object.defineProperty(function () {}, "prototype", { value: { marker: 1 } }), "prototype")) + " " + attempt(() => describe(Object.defineProperty(() => 1, "prototype", { value: 5 }), "prototype")));
  lines.push(attempt(() => new (Object.defineProperty(function () {}, "prototype", { value: { marker: 7 } }))().marker) + " " + attempt(() => Object.defineProperty(function named() {}, "name", { get() { return "got"; } }).name));
  lines.push(attempt(() => Object.defineProperty(Object.preventExtensions(() => 1), "tag", { value: 1 }).tag) + " " + attempt(() => Object.defineProperty(Object.freeze(function () {}), "tag", { value: 1 }).tag) + " " + attempt(() => Object.defineProperty(Object.defineProperty(() => 1, "tag", { value: 1 }), "tag", { value: 2 }).tag) + " " + attempt(() => Object.defineProperty(Object.defineProperty(() => 1, "tag", { value: 1, configurable: true }), "tag", { value: 2 }).tag));
  const C = class { static fixed = 1; static method() { return 2; } }; Object.defineProperty(C, "tag", { value: i }); Object.defineProperty(C, "fixed", { value: 10 }); lines.push(C.tag + " " + C.fixed + " " + describe(C, "tag") + " " + describe(C, "fixed") + " " + Reflect.ownKeys(C).join());
  const b = function () { return this; }.bind(3); Object.defineProperty(b, "tag", { value: i }); const g = function* () {}; Object.defineProperty(g, "tag", { value: i }); const a = async () => 1; Object.defineProperty(a, "tag", { value: i, enumerable: true }); lines.push(describe(b, "tag") + " " + describe(g, "tag") + " " + describe(a, "tag") + " " + Object.keys(a).join());
}
{
  class A {}
  const plain = [() => 1, () => 2, () => 3, () => 4];
  for (const f of plain) Object.defineProperty(f, "tag", { value: 1 });
  const bound = A.bind(null); Object.defineProperty(bound, "tag", { value: 1 });
  const boundAsync = (async function () {}).bind(null); Object.defineProperty(boundAsync, "tag", { value: 2 });
  lines.push(["bound", new A() instanceof bound, {} instanceof bound, bound.tag, bound.name, "prototype" in bound, boundAsync.tag, boundAsync.name, "prototype" in boundAsync].join(" "));
}
console.log(lines.join("\n"));
