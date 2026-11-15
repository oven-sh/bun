// The class has two fields and no word for extra properties. The first object that unknown code extends gets a Structure of its own, the next ones are born with a spare word behind their fields.
function Made(car, cdr) { this.car = car; this.cdr = cdr; }
function key(a, b) { return a + b; }
function extend(o, k, v) { o[k] = v; return o; }
function look(o, k) { return o[k]; }
function show(o) {
  return Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + (d.enumerable ? "" : "-") + "=" + (d.get ? "get" + look(o, k) : typeof d.value === "object" && d.value ? "o" : String(d.value)); }).join(" ");
}
const ways = [
  (o, k) => extend(o, key("x", k % 3), k),
  (o, k) => Object.defineProperty(o, key("g", 0), { get() { return k; }, configurable: true }),
  (o, k) => extend(o, k % 4, "element"),
  (o, k) => Object.assign(o, { [key("s", k % 2)]: k }),
  (o, k) => { extend(o, key("t", 0), k); delete o[key("t", 0)]; },
  (o, k) => { for (let i = 0; i < 9; i++) extend(o, key("m", i), [i, k]); },
  (o, k) => Object.freeze(extend(o, key("f", 0), k)),
  (o, k) => Object.setPrototypeOf(extend(o, key("p", 0), k), { inherited: 1 }),
  (o, k) => extend(o, Symbol.for("symbol"), k),
];
const kept = [];
for (let round = 0; round < 4; round++) {
  if (round === 1) for (const other of JSON.parse('[{"other":1},[2]]')) for (const way of ways) { try { way(other, 3); } catch (e) { console.log(e.name); } }
  let list = null;
  for (let k = 0; k < 40; k++) {
    const made = new Made(k, list);
    if (round) ways[(k + round) % ways.length](made, k);
    list = k % 5 === 4 ? null : made;
    if (k % 2) kept.push(made);
  }
  let junk = null;
  for (let k = 0; k < 20000; k++) { junk = new Made(k, k % 64 ? junk : null); if (round === 2 && k % 100 === 0) extend(junk, key("j", k % 7), [junk, k]); if (k % 1000 === 0) kept.push(junk); }
  if (round % 2) Bun.gc(true);
  console.log(round, kept.length, kept.slice(-8).map(show).join(" | "), show(junk));
}
Bun.gc(true);
let sum = 0;
for (const o of kept) sum = (sum * 31 + show(o).length) % 1000003;
console.log(sum, kept.filter(o => o instanceof Made).length, show(new Made(1, null)), show(extend(new Made(2, null), key("y", 1), 3)));
console.log(Object.entries(structuredClone(extend(new Made(8, null), key("c", 1), 10))).join());
