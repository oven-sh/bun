// -0 goes into a Set or among the keys of a Map, +0 comes out: into a parameter, a field, a variable, a result, a callback
function show(...all) { console.log(all.join(" ")); }
function inverse(x) { return 1 / x; }
function plusOne(x) { return x + 1; }
class Holder { constructor(v) { this.f = v; } inverse() { return 1 / this.f; } isZero() { return this.f === 0; } }
let kept;
function first(set) { for (const v of set) return v; }
function main() {
  const set = new Set([-0]);
  for (const v of set) { show("parameter", inverse(v), plusOne(v)); const h = new Holder(v); show("field", h.inverse(), h.isZero()); kept = v; }
  show("variable", 1 / kept, kept + 1, kept === 0);
  const r = first(set); show("result", 1 / r, r + 1, r === 0);
  set.forEach(v => show("callback", 1 / v, v + 1, v === 0));
  const it = set.values().next().value; show("next", 1 / it, it + 1);
  for (const [k] of new Map([[-0, 1]])) show("key", 1 / k, k + 1, inverse(k));
  new Map([[-0, 1]]).forEach((v, k) => show("key in a callback", 1 / k, k + 1));
}
main();
