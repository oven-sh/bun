// Arrays of one maker: one of them is given a fraction, so all are predicted to hold doubles.
"use strict";
const n = 24, log = [];
function list(f) { const a = []; for (let i = 0; i < n; i++) a.push(f(i)); return a; }
const keys = list(i => i * 7 % n), values = list(i => Math.imul(i + 3, 0x9e3779b9) | 0), halves = list(i => i * .5);
function changed(a, at, v) { const b = a.slice(); b[at] = v; return b; }
function inDoubles(a) { const b = a.slice(); for (let i = 0; i < n; i++) b[i] += .5; for (let i = 0; i < n; i++) b[i] -= .5; return b; }
function few(t) { let s = t.length + ":"; for (let i = 0; i < n; i++) s += t[i] + ","; return s; }
class Table {
  constructor(values, places, target) { this.values = values; this.places = places; this.target = target; }
  xor() { let x = 0; for (let i = 0; i < n; i++) x = x ^ this.values[this.places[i]]; return x; }
  sum() { let s = 0; for (let i = 0; i < n; i++) s += this.values[this.places[i]]; return s; }
  cut() { let s = 0; for (let i = 0; i < n; i++) s = s + this.values[this.places[i]] | 0; return s; }
  gather() { const a = this.values, b = this.places, t = this.target; for (let i = 0; i < n; i++) t[i] = a[b[i]]; return few(t); }
  permute() { const a = this.values, b = this.places, t = this.target; for (let i = 0; i < n; i++) t[b[i]] = a[i]; return few(t); }
  count() { const b = this.places, t = this.target; for (let i = 0; i < n; i++) t[b[i]]++; return few(t); }
  chain() { let x = 1; for (let i = 0; i < n; i++) x = this.places[x]; return x; }
  local(a, b) { let x = 0; for (let i = 0; i < n; i++) x = x + a[b[i]] | 0; return x; }
  turned(a, b) { let x = 0; for (let i = 0; i < n; i++) { x = x ^ a[b[i]]; if (i === 9) b[14] = this.late; } return x; }
}
const places = { keys: () => keys.slice(), doubles: () => inDoubles(keys), fraction: () => changed(inDoubles(keys), 3, 2.5), minusZero: () => changed(inDoubles(keys), 3, -0), negative: () => changed(inDoubles(keys), 3, -1), past: () => changed(inDoubles(keys), 3, 99), far: () => changed(inDoubles(keys), 3, 2147483648), farther: () => changed(inDoubles(keys), 3, 4294967295), farthest: () => changed(inDoubles(keys), 3, 4294967296), least: () => changed(inDoubles(keys), 3, -2147483649), huge: () => changed(inDoubles(keys), 3, 1e300), infinite: () => changed(inDoubles(keys), 3, Infinity), nan: () => changed(inDoubles(keys), 3, NaN), hole: () => { const b = keys.slice(); delete b[4]; return b; }, holeInDoubles: () => { const b = inDoubles(keys); delete b[4]; return b; }, text: () => changed(keys, 3, "7"), word: () => changed(inDoubles(keys), 3, "length"), nothing: () => changed(keys, 3, undefined), object: () => changed(keys, 3, { toString() { log.push("place"); return "6"; } }), frozen: () => Object.freeze(inDoubles(keys)), short: () => [1, 2.5], view: () => new Float64Array(keys), accessor: () => Object.defineProperty(inDoubles(keys), 5, { get() { log.push("get"); return 2; } }) };
const contents = { ints: () => values.slice(), doubles: () => inDoubles(values), halves: () => halves.slice(), hole: () => { const a = halves.slice(); delete a[7]; return a; }, nan: () => changed(halves, 7, NaN), text: () => changed(values, 7, "12"), nothing: () => changed(halves, 7, undefined), object: () => changed(values, 7, { valueOf() { log.push("value"); return 9; } }), big: () => changed(values, 7, 4n), view: () => new Int32Array(values), none: () => [] };
const lates = [3, 2.5, NaN, "4", undefined, { valueOf() { log.push("late"); return 2; }, toString() { log.push("text"); return "2"; } }];
const names = ["xor", "sum", "cut", "gather", "permute", "count", "chain"];
function show(f) { try { const v = f(); return Object.is(v, -0) ? "-0" : typeof v + String(v); } catch (error) { return "threw " + error.name; } }
for (const c in contents) for (const p in places) {
  const lines = names.map(name => show(() => new Table(contents[c](), places[p](), halves.slice())[name]()));
  const table = new Table(contents[c](), places[p](), keys.slice());
  lines.push(show(() => table.permute()), show(() => table.local(contents[c](), places[p]())));
  for (const late of lates) { table.late = late; lines.push(show(() => table.turned(contents[c](), places[p]()))); }
  console.log(c, p, lines.join(" "), log.splice(0).join());
}
