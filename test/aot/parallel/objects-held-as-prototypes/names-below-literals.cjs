// COUNTER: CompiledObjectEnumeratorsFound >= 400
// for-in over ordinary objects below literals: the names follow from the structures and key orders of the chain, and every change of one of them is seen.
const base = { extend(fields) { const below = Object.create(this); for (const name in fields) if (Object.hasOwn(fields, name)) below[name] = fields[name]; return below; }, kind: "base", get size() { return 3; } };
const names = o => { const listed = []; for (const name in o) listed.push(name); return listed.join(); };
const middle = base.extend({ a: 1, kind: "middle" }), leaf = middle.extend({ b: 2 }), twin = middle.extend({ b: 3 });
let length = 0; for (let i = 0; i < 400; i++) length += names(i & 1 ? leaf : twin).length;
console.log(length, names(leaf));
const changes = [
  () => { base.added = 1; }, () => { delete base.added; }, () => { base.added = 2; }, () => { middle.late = 1; }, () => { delete middle.a; }, () => { leaf.b = 9; leaf.c = 1; }, () => { Object.defineProperty(base, "kind", { enumerable: false }); },
  () => { Object.defineProperty(middle, "hidden", { value: 1, enumerable: false, configurable: true }); }, () => { base.hidden = 2; }, () => { Object.defineProperty(middle, "hidden", { enumerable: true }); }, () => { middle[2] = "element"; }, () => { base[1] = "element"; }, () => { delete middle[2]; },
  () => { Object.setPrototypeOf(middle, { other: 1 }); }, () => { Object.setPrototypeOf(middle, base); }, () => { Object.setPrototypeOf(base, { above: 1, kind: 2 }); }, () => { Object.freeze(base); }, () => { Object.setPrototypeOf(leaf, null); },
  () => { base.extend = undefined; }, () => { twin.added = 3; }, () => { Object.defineProperty(middle, "late", { get() { return 1; } }); }, () => { middle[Symbol("s")] = 1; }, () => { Object.setPrototypeOf(twin, new Proxy({ p: 1 }, {})); },
];
for (const change of changes) { change(); console.log(names(leaf), "|", names(leaf), "|", names(twin), "|", names(middle), "|", names(base)); }
const other = { x: 1, y: 2 }; const seen = [];
for (let turn = 0; turn < 6; turn++) { const o = Object.create(other); o.own = 1; o.last = 2; for (const name in o) { seen.push(name); if (name === "own") { if (turn === 1) delete o.last; if (turn === 2) delete other.x; if (turn === 3) other.z = 1; if (turn === 4) Object.defineProperty(other, "y", { enumerable: false }); } } seen.push("/"); }
console.log(seen.join(" "));
