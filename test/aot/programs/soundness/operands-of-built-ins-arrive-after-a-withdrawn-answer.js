// The key is read from a field through a leak of this before the field is stored, so undefined joins it only when the first answer about the construction is withdrawn: the operands of the built-ins below arrive after everything else has come to rest.
class C { constructor() { peek(this); this.k = "a"; } }
let key;
function peek(o) { key = o.k; }
function main() {
  const c = new C();
  const target = { x: 0 };
  const stored = { p: 0, q: 0 };
  const defined = {};
  const child = {};
  const protoA = { who() { return 1; } }, protoB = { who() { return "b"; } };
  function first(a) { return "first " + typeof a; }
  function second(a) { return "second " + typeof a; }
  for (let round = 0; round < 2; round++) {
    const pattern = { a: "a", undefined: /(b)/g }[key];
    console.log("aabb".replace(pattern, (m, p) => typeof p));
    try { console.log(Reflect.set({ a: 1, undefined: target }[key], "x", { late: 1 })); } catch (e) { console.log("threw"); }
    Reflect.set(stored, { a: "p", undefined: "q" }[key], round ? 1 : "text");
    Object.defineProperty(defined, "d", { a: { value: 1, configurable: true }, undefined: { get() { return "getter"; }, configurable: true } }[key]);
    console.log(typeof defined.d);
    Object.setPrototypeOf(child, { a: protoA, undefined: protoB }[key]);
    console.log(child.who());
    console.log(typeof Object.create({ a: protoA, undefined: protoB }[key]).who());
    console.log(Math.max({ a: 1, undefined: 0.5 }[key], 0), Math.abs({ a: -1, undefined: "-2.5" }[key]));
    const bound = { a: first, undefined: second }[key].bind(null, { a: 1, undefined: "s" }[key]);
    console.log(bound());
    console.log(typeof Symbol.for({ a: "one", undefined: "two" }[key]).description.length);
    console.log(JSON.stringify({ v: 1, w: 2 }, { a: null, undefined: ["w"] }[key]));
    const m = new Map();
    m.set({ a: 1, undefined: "k" }[key], { a: 1, undefined: { v: 1 } }[key]);
    for (const [k, v] of m) console.log(typeof k, typeof v);
    peek(c);
  }
  console.log(typeof target.x, typeof stored.p, typeof stored.q);
}
main();
