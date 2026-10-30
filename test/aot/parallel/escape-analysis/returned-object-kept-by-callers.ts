// A function returns a small array or object: callers that keep it, compare it, list its keys or pass it on must get one real object.
declare const console: { log(...v: unknown[]): void };
function big(x: number): number { let s = 0; for (let i = 0; i < 3; i++) { s += (x + i) * (x - i); if (s > 1e9) s -= 1e9; } return s; }
function pair(x: number): [number, number] {
  let a = big(x), b = big(x + 1); for (let i = 0; i < 2; i++) { a += big(a & 7); b += big(b & 7); if (a > 1e12) a = 1; if (b > 1e12) b = 2; }
  if (a > b) return [b, a]; //! removed; heap
  return [a, b];
}
function record(x: number): { lo: number, hi: number } {
  let a = big(x), b = big(x + 1); for (let i = 0; i < 2; i++) { a += big(a & 7); b += big(b & 7); if (a > 1e12) a = 1; if (b > 1e12) b = 2; }
  return { lo: a, hi: b }; //! removed; heap
}
// No caller only reads: there is no second body.
function onlyKept(x: number): [number, number] {
  let a = big(x), b = big(x + 1); for (let i = 0; i < 2; i++) { a += big(a & 7); b += big(b & 7); if (a > 1e12) a = 1; if (b > 1e12) b = 2; }
  return [a, b]; //! heap
}
// One of the two is not fresh, so nothing is known about the returned object.
const shared: [number, number] = [1, 2];
function sometimesShared(x: number): [number, number] {
  let a = big(x); for (let i = 0; i < 2; i++) { a += big(a & 7); if (a > 1e12) a = 1; }
  if (a > 100) return shared;
  return [a, a]; //! heap
}
// It has escaped before it is returned.
const seen: [number, number][] = [];
function escapes(x: number): [number, number] {
  let a = big(x); for (let i = 0; i < 2; i++) { a += big(a & 7); if (a > 1e12) a = 1; }
  const made: [number, number] = [a, a + 1]; //! heap
  seen.push(made);
  return made;
}
let t = 0;
for (let i = 0; i < 50; i++) { const [p, q] = pair(i); t += q - p; const { lo, hi } = record(i); t += hi - lo; }
const kept: [number, number][] = []; function keep(x: [number, number]): void { kept.push(x); }
for (let i = 0; i < 3; i++) { const x = pair(i); keep(x); keep(x); }
console.log(kept.length, kept[0] === kept[1], kept[1] === kept[2], kept[4][1], pair(1) === pair(1), record(1) === record(1));
const r = record(4); console.log(Object.keys(r).join(), r === r, JSON.stringify(record(2)), "lo" in r, pair(3).length, pair(3).join("+"), Array.isArray(pair(3)));
// An index beyond the end, a key that is not a field.
const beyond = pair(5) as unknown as number[]; console.log(beyond[2], (record(5) as any).other);
// Written to after the call.
const w = pair(6); w[0] = -1; console.log(w[0], w[1]); const v = record(6); v.lo = -2; console.log(v.lo, v.hi);
// Through a function value, and a table of them.
const table: ((x: number) => [number, number])[] = [pair, onlyKept, sometimesShared, escapes];
for (const f of table) { const [p, q] = f(9); t += p + q; }
const x1 = onlyKept(1), x2 = onlyKept(2); keep(x1); keep(x2);
for (let i = 0; i < 5; i++) { const [p, q] = sometimesShared(i); t += p + q; const [a, b] = escapes(i); t += a + b; }
console.log(sometimesShared(50) === sometimesShared(60), seen.length, seen[0] === seen[0], escapes(1) === seen[seen.length - 1]);
// Own elements are read whatever the prototype has. (The compiled program rejects the definition, because `Array.prototype` takes no key that is an index; plain Bun accepts it. Neither is visible here.)
try { Object.defineProperty(Array.prototype, "0", { get() { return "from the prototype"; }, configurable: true }); } catch {}
{ const [p, q] = pair(8); console.log(p, q); }
try { delete (Array.prototype as any)[0]; } catch {}
console.log(t, kept.length);
