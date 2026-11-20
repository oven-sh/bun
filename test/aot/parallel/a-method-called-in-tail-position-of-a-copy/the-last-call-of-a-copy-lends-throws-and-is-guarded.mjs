class Box {
  constructor(v) { this.v = v; }
  get bad() { throw new RangeError("getter"); }
  take(f) { return f(this.v); }
  add(p) { return this.v + p.x; }
}
class Bag {
  constructor(v) { this.w = v; }
  get bad() { throw new RangeError("bag"); }
  take(f) { return f(this.w) * 10; }
  add(p) { return this.w - p.x; }
}
function callsTake(b, k) { return b.take((x) => x + k); }
function callsAdd(b, k) { return b.add({ x: k }); }
function callsMissing(b) { return b.nothing(1); }
function callsBad(b) { return b.bad(1); }
function mapped(list, k) { return list.map((x) => x + k); }
function each(table, k) { let sum = 0; const seen = walk(table, (value) => { sum += value + k; }); return sum + String(seen); }
function walk(table, f) { return table.forEach(f); }
async function waits(b, k) { const r = await callsAdd(b, k); return r * 2; }
function all(b, list, table, k) {
  let out = "";
  try { out += callsTake(b, k) + ","; out += callsAdd(b, k) + ","; out += mapped(list, k).join("") + ","; out += each(table, k) + ","; } finally { out += "f,"; }
  try { out += callsMissing(b); } catch (e) { out += (e instanceof TypeError) + ","; }
  try { out += callsBad(b); } catch (e) { out += e.message; }
  return out;
}
const k = JSON.parse("2");
const holders = JSON.parse("[0, 1]").map((which) => (which ? new Bag(5) : new Box(5)));
const tables = JSON.parse("[0, 1]").map((which) => (which ? new Set([1, 2]) : new Map([[1, 3], [2, 4]])));
for (const which of JSON.parse("[0, 1]")) console.log(all(holders[which], JSON.parse("[1, 2]"), tables[which], k), await waits(holders[which], k));
