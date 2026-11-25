// The text of an object that has index keys beside its names: indexes first, in ascending order.
let calls = 0;
function made(keys) { const out = { n: 0 }; for (const key of keys) { const inner = out[key] || (out[key] = { n: 0, list: [] }); inner.n++; inner[key] = (inner[key] | 0) + 1; inner.list.push(key); } return out; }
class Record { constructor(n) { this.n = n; this.late = "x"; } }
const makers = [
  () => made([1, 1.5, "1", "q"]), () => made([0]), () => made([3, 0, 2, "b", "a", 1]), () => made(["-1", "01", -0, 4294967294, 4294967295]),
  () => { const o = { a: 1 }; o[2] = undefined; o[4] = "four"; o.b = null; return o; }, () => { const o = { a: 1 }; for (let i = 0; i < 5; i++) o[i] = i / 2; return o; }, () => { const o = { a: 1 }; for (let i = 0; i < 5; i++) o[i * 2] = i; delete o[4]; return o; },
  () => { const o = new Record(1); o[1] = [o.n, { 0: "deep", z: 1 }]; return o; }, () => { const o = { a: 1 }; o[5000000] = 1; o[1] = 2; return o; }, () => { const o = { a: 1 }; o[0] = () => 1; o[1] = Symbol("s"); o[2] = NaN; return o; },
  () => { const o = { a: 1 }; Object.defineProperty(o, 1, { get() { calls++; return 7; }, enumerable: true }); o[0] = 1; return o; }, () => { const o = { a: 1 }; Object.defineProperty(o, 1, { value: 7, enumerable: false }); o[0] = 1; return o; },
  () => { const o = { a: 1 }; o[0] = 1; o.toJSON = key => { calls++; return ["own", key]; }; return o; }, () => { const o = Object.create({ toJSON(key) { calls++; return ["inherited", key]; }, 1: "up" }); o[0] = 1; o.a = 2; return o; },
  () => { const o = { a: 1 }; o[0] = "中é\"\n"; o["é"] = 1; return o; }, () => { const o = { a: 1 }; o[0] = { toJSON(key) { calls++; return key + key; } }; return o; }, () => Object.freeze(made([1, "x"])), () => { const o = made([2]); delete o.n; o.n = 1; return o; },
];
for (let turn = 0; turn < 3; turn++) {
  for (const make of makers) {
    const o = make();
    console.log(JSON.stringify(o), JSON.stringify([o, { o, 1: o }]), JSON.stringify(o, null, 1), JSON.stringify(o, (key, value) => typeof value === "number" ? value + 1 : value), JSON.stringify(o, ["1", "n", 0]), Object.keys(o).join(), calls);
  }
}
const cyclic = { n: 1 }; cyclic[0] = { up: cyclic };
try { JSON.stringify(cyclic); } catch (error) { console.log(error.constructor.name); }
