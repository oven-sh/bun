// A read of `get name() { return this.field; }` may read the field. Whether the object itself holds the name is asked at the same places, and the answer stays no.
class Plain { constructor(i) { if (i & 1) this._a = () => i; } get b() { return this._b; } }
class Padded { constructor(i) { this.pad = i; this._b = null; this._a = true; if (i & 1) this._c = { deep: i }; this.x = i + 0.5; } get b() { return this._b; } }
class Derived extends Padded { constructor(i) { super(i); this.x = "t" + i; this._c = i; this._b = i + 0.5; } get a() { return this._a; } get c() { return this._a; } get b() { return this._b; } }
class Empty { constructor(i) { this._a = null; } get a() { return this._a; } }
globalThis.kept = [Plain, Padded, Derived, Empty];
const list = []; for (let i = 0; i < 30; i++) list.push(new globalThis.kept[i % 4](i));
globalThis.list = list;
function ask(o) { let s = ""; if (o.a) s += "y"; return s + ("a" in o) + Object.hasOwn(o, "a") + o.hasOwnProperty("b"); }
function askKey(o, key) { const value = o[key]; return (value === undefined ? "u" : typeof value) + (key in o) + Object.hasOwn(o, key); }
const acts = [
  () => {},
  () => { Object.setPrototypeOf(Derived.prototype, { b: "above all", _b: "field above" }); },
  () => { delete list[3]._a; },
  () => { Object.defineProperty(Derived.prototype, "c", { get() { return "changed"; }, configurable: true }); },
  () => { Object.defineProperty(list[2], "a", { value: "own", configurable: true }); },
  () => { Object.defineProperty(list[6], "_a", { get() { return "field got"; }, configurable: true }); },
  () => { delete Derived.prototype.a; },
  () => { Derived.prototype.__defineGetter__("a", function () { return this._c; }); },
];
for (let round = 0; round < 9; round++) {
  const seen = new Set();
  for (let turn = 0; turn < 8; turn++) {
    let s = "";
    for (const o of globalThis.list) s += ask(o) + " " + askKey(o, "a") + askKey(o, "b") + askKey(o, "c") + askKey(o, "_a") + ";";
    seen.add(s);
  }
  console.log(round, seen.size, [...seen][0].slice(0, 400));
  if (round < acts.length) acts[round]();
}
