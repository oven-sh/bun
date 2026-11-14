// The rest of an object with a getter and an own property named __proto__, taken again: what stands behind __proto__ belongs to the rest.
const said = [];
const show = o => JSON.stringify(Object.entries(Object.getOwnPropertyDescriptors(o)).map(([k, d]) => [k, "value" in d ? (typeof d.value === "function" ? "f" : d.value) : "accessor", d.enumerable])) + Object.getOwnPropertySymbols(o).length;
function rest(o) { const { x1, ...all } = o; return all; }
function restOfTwo(o) { const { b, z, ...all } = o; return all; }
function restOfNone(o) { const { ...all } = o; return all; }
function restOfKey(o, key) { const { [key]: taken, ...all } = o; return all; }
function spread(o) { return { ...o }; }
function spreadBehind(o) { return { first: 0, ...o, last: 1 }; }
function assign(o) { return Object.assign({}, o); }
function names(o) { let t = ""; for (const k in o) t += k + ","; return t; }
const symbol = Symbol("s");
let calls = 0;
const makers = [
  () => ({ get c() { return 1; }, b: 1, ["__proto__"]: 5, z: 1 }),
  () => ({ ["__proto__"]: 5, get c() { return 1; }, b: 1, z: 1 }),
  () => ({ get c() { return ++calls; }, ["__proto__"]: 5, b: 1, z: 1 }),
  () => ({ b: 1, get c() { return 1; }, z: 1, ["__proto__"]: 5 }),
  () => ({ b: 1, ["__proto__"]: 5, get c() { return 1; }, z: 1 }),
  () => ({ b: 1, get c() { return 1; }, 7: 2, z: 1 }),
  () => ({ get c() { return 1; }, b: 1, ["5"]: 5, z: 1, ["__proto__"]: 6, y: 2 }),
  () => ({ get c() { return 1; }, b: 1, [symbol]: 5, ["__proto__"]: 6, z: 1 }),
  () => ({ get c() { return 1; }, b: 1, m() { return 2; }, ["__proto__"]: null, z: 1 }),
  () => ({ get c() { return 1; }, get ["__proto__"]() { return 8; }, b: 1, z: 1 }),
  () => ({ get c() { return 1; }, set c(v) {}, b: 1, z: 1 }),
  () => ({ b: 1, ["__proto__"]: 5, z: 1 }),
  () => { const o = { get c() { return 1; }, b: 1 }; Object.defineProperty(o, "__proto__", { value: 3, enumerable: true, configurable: true }); o.z = 4; return o; },
  () => { const o = { get c() { return 1; }, b: 1, ["__proto__"]: 5, z: 1 }; delete o.b; o.b = 2; return o; },
];
for (const make of makers) {
  const kept = make();
  for (let i = 0; i < 4; i++) {
    const o = i < 2 ? make() : kept;
    said.push(show(rest(o)), show(restOfTwo(o)), show(restOfNone(o)), show(restOfKey(o, "c")), show(restOfKey(o, "__proto__")), show(spread(o)), show(spreadBehind(o)), show(assign(o)), names(o), JSON.stringify(o), Object.entries(o).map(([k, v]) => k + typeof v).join(), Object.keys(o).join(), Object.values(o).length);
  }
}
for (let i = 0; i < 2; i++) said.push(JSON.stringify(rest({ get c() { return 1; }, b: 1, ["__proto__"]: 5, z: 1 })));
console.log(calls);
console.log(said.join("\n"));
