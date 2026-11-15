// Literals with computed keys whose names the program reads: which keys there are, in what order, and what they hold.
const lists = {
  names: ["a", "b", "c"],
  listed: ["z", "a", "z"],
  others: ["q", "a", "toString"],
  odd: ["__proto__", "constructor", ""],
  elements: ["1", 0, "a"],
  ropes: ["a" + "", "xb".slice(1), String.fromCharCode(99)],
  symbols: [Symbol.for("a"), "a", undefined],
};
const show = o => Reflect.ownKeys(o).map(key => String(key) + ":" + String(o[key])).join() + "|" + JSON.stringify(o) + "|" + Object.entries(o).join(";");
function first(keys) {
  let n = "";
  for (let k = 0; k < 6; k++) { const x = keys[k % 3]; const o = { [x]: k, z: 2 }; n += (o.a ?? o.b ?? o.c ?? "-") + show(o) + " "; }
  return n;
}
function last(keys) {
  let n = "";
  for (let k = 0; k < 6; k++) { const x = keys[k % 3]; const o = { z: "s", [x]: k / 2 }; n += (o.a || o.b) + show(o) + " "; }
  return n;
}
function middle(keys) {
  let n = "";
  for (let k = 0; k < 6; k++) { const x = keys[k % 3]; const o = { a: 1, [x]: [k], z: null }; n += o.b + show(o) + " "; }
  return n;
}
function twice(keys) {
  let n = "";
  for (let k = 0; k < 6; k++) { const x = keys[k % 3], y = keys[(k + 1) % 3]; const o = { [x]: 1, [y]: 2, [x]: 3 }; n += (o.a ?? o.b) + show(o) + " "; }
  return n;
}
function changes(keys) {
  let n = "";
  for (let k = 0; k < 6; k++) {
    const x = keys[k % 3];
    const o = { [x]: 1, z: 2 };
    if (k === 1) delete o.a;
    if (k === 2) o.a = "late";
    if (k === 3) Object.freeze(o);
    if (k === 4) Object.defineProperty(o, "b", { get() { return "got"; }, enumerable: true, configurable: true });
    if (k === 5) o.added = k;
    n += o.a + "," + o.b + show(o) + ("a" in o) + o.hasOwnProperty("b") + " ";
  }
  return n;
}
function spread(keys) {
  let n = "";
  for (let k = 0; k < 6; k++) { const x = keys[k % 3]; const o = { ...{ b: 1, w: 2 }, [x]: k }; const { a, ...rest } = o; n += a + show(rest) + show({ ...o, z: 1 }) + " "; }
  return n;
}
function inherits(keys) {
  let n = "";
  for (let k = 0; k < 6; k++) { const x = keys[k % 3]; const o = { __proto__: { a: "above", b: "above" }, [x]: k }; n += o.a + o.b + show(o) + " "; }
  return n;
}
const make = (x, v) => ({ [x]: v, kind: "made" });
function made(keys) {
  let n = "";
  for (let k = 0; k < 6; k++) { const o = make(keys[k % 3], k); n += o.kind + o.a + o.c + show(o) + " "; }
  return n;
}
for (const [name, keys] of Object.entries(lists))
  for (const run of [first, last, middle, twice, changes, spread, inherits, made])
    console.log(name, run.name, run(keys));
