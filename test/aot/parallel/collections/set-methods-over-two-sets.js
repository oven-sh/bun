// Set methods and lookups of numbers over keys of every kind.
const seed = JSON.parse("[1,2,3]"), text = JSON.parse('"alpha beta gamma delta epsilon zeta eta theta iota kappa"');
const symbolA = Symbol("a"), symbolB = Symbol("b"), objects = Array.from({ length: 6 }, (_, i) => ({ i })), functionA = () => 1;
const half = seed[0] / 2, zero = seed[0] - 1, negativeZero = -zero, nan = zero / zero, big = BigInt(seed[2]) ** 40n;
const pieces = text.split(" "), rope = pieces[0] + pieces[1], sub = text.slice(6, 10);
function show(v) {
  if (typeof v === "string") return "'" + v + "'";
  if (typeof v === "bigint") return v + "n";
  if (typeof v === "symbol") return v.toString();
  if (typeof v === "function") return "fn";
  if (typeof v === "object" && v !== null) return Array.isArray(v) ? "[" + v.map(show).join() + "]" : "{" + v.i + "}";
  return Object.is(v, -0) ? "-0" : String(v);
}
const kinds = {
  none: () => [],
  ints: n => Array.from({ length: n }, (_, i) => i * 3 - 5),
  odds: n => Array.from({ length: n }, (_, i) => i * 2 + 1),
  doubles: n => Array.from({ length: n }, (_, i) => i * half + 0.25),
  mixedNumbers: n => Array.from({ length: n }, (_, i) => (i % 3 ? i : i * half)),
  edges: () => [zero, negativeZero, nan, Infinity, -Infinity, 2 ** 31, -(2 ** 31), 2 ** 31 - 1, 2 ** 53, 1e21, half, -half, 5e-324],
  strings: n => Array.from({ length: n }, (_, i) => "k" + i),
  pieces: () => text.split(" "),
  ropes: n => Array.from({ length: n }, (_, i) => pieces[i % 4] + pieces[(i + 1) % 4] + (i >> 2)),
  odd: () => [undefined, null, true, false, symbolA, symbolB, functionA],
  objects: () => objects.slice(0, 4),
  otherObjects: () => objects.slice(2),
  bigs: n => Array.from({ length: n }, (_, i) => BigInt(i) * big),
  mixed: n => Array.from({ length: n }, (_, i) => [i, "k" + i, i * half, undefined, objects[i % 6], BigInt(i), symbolA, null][i % 8]),
  wide: () => ["é", "日本", "a", "日" + pieces[0], text.slice(0, 5)],
};
const sizes = [1, 3, 8, 9, 40, 300];
const deletions = { keep: () => {}, some: s => { let i = 0; for (const k of [...s]) if (i++ % 3 === 1) s.delete(k); }, most: s => { let i = 0; for (const k of [...s]) if (i++ % 7) s.delete(k); }, emptied: s => { for (const k of [...s]) s.delete(k); }, again: s => { const all = [...s]; for (const k of all) s.delete(k); for (const k of all) s.add(k); }, cleared: s => { const all = [...s]; s.clear(); for (let i = 0; i < all.length; i += 2) s.add(all[i]); } };
function make(kind, n, deletion) { const s = new Set(); for (const k of kinds[kind](n)) s.add(k); deletions[deletion](s); return s; }
function fingerprint(s) { const l = [...s]; return l.length <= 12 ? l.map(show).join() : l.length + ":" + l.slice(0, 4).map(show).join() + ".." + l.slice(-3).map(show).join(); }
function after(s) { const n = s.size; s.add("added"); s.delete([...s][0]); s.add(12345); s.add(objects[0]); s.add(0.75); return n + ">" + s.size + (s.has("added") ? "y" : "n") + (s.has(12345) ? "y" : "n") + (s.has(0.75) ? "y" : "n") + fingerprint(s); }
const all = process.argv[2] === "all"; let lines = 0, hash = 0;
function say(line) { lines++; for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0; if (all) console.log(line); else if (lines % 97 === 0) console.log(lines, hash); }
const names = Object.keys(kinds), deletionNames = Object.keys(deletions);
let turn = 0;
for (const a of names) for (const b of names) for (const n of sizes) {
  const d1 = deletionNames[turn % deletionNames.length], d2 = deletionNames[(turn * 5 + 2) % deletionNames.length]; turn++;
  const x = make(a, n, d1), y = make(b, sizes[turn % sizes.length], d2), label = [a, b, n, d1, d2].join(" ");
  const held = x.values(); held.next();
  say(label + " u " + fingerprint(x.union(y)) + " | " + after(x.union(y)));
  say(label + " i " + fingerprint(x.intersection(y)) + " | " + after(x.intersection(y)));
  say(label + " d " + fingerprint(x.difference(y)) + " | " + after(x.difference(y)));
  say(label + " s " + fingerprint(x.symmetricDifference(y)) + " | " + after(x.symmetricDifference(y)));
  say(label + " t " + x.isSubsetOf(y) + x.isSupersetOf(y) + x.isDisjointFrom(y) + x.isSubsetOf(x) + x.union(x).isSubsetOf(x));
  say(label + " h " + show(held.next().value) + fingerprint(x) + fingerprint(y));
}
// constants of the file, subclasses, own methods, set-like objects, what throws
const constant = new Set(["alpha", "beta", "gamma"]), constantNumbers = new Set([1, 2, 3]);
class Sub extends Set { has(k) { calls++; return super.has(k); } }
let calls = 0;
const sub1 = new Sub([1, 2, "alpha"]), own = new Set([1, "alpha"]); own.has = k => { calls += 100; return true; };
const like = { size: 2, has: k => k === 1 || k === "beta", keys: () => ["beta", 7][Symbol.iterator]() }, map = new Map([[1, 2], ["alpha", 3]]);
for (const x of [constant, constantNumbers, sub1, own, new Set(), new Set([1, 2, "alpha", "beta", 0.5])]) for (const y of [constant, constantNumbers, sub1, own, like, map, new Set(), new Set(["alpha", 2, half])])
  for (const m of ["union", "intersection", "difference", "symmetricDifference", "isSubsetOf", "isSupersetOf", "isDisjointFrom"]) { let r; try { r = x[m](y); r = typeof r === "boolean" ? r : fingerprint(r) + r.constructor.name; } catch (e) { r = e.name + e.message; } say(m + " " + r + " " + calls); }
for (const y of [undefined, null, 1, "a", [1], {}, { size: nan, has() {}, keys() {} }, { size: -1, has() {}, keys() {} }, { size: 1, has: 1, keys() {} }]) for (const m of ["union", "isSubsetOf"]) { let r; try { r = new Set([1])[m](y); } catch (e) { r = e.name; } say(m + " throws " + r); }
// lookups under numbers
const tables = { ints: kinds.ints(40), doubles: kinds.doubles(40), edges: kinds.edges(), strings: kinds.strings(9), mixed: kinds.mixed(40), none: [], small: [0.5, 1, "a"], bigs: kinds.bigs(9) };
const sought = [...kinds.edges(), 0.25, 0.75, 1.25, 3, 4, 1.5 * 2, seed[2] * 1.0, half * 2, half * 4, "k1", "alpha", undefined, null, true, objects[1], 1n, symbolA, -0, 7.000000001, 1e300];
for (const name of Object.keys(tables)) {
  const m = new Map(), s = new Set(tables[name]); tables[name].forEach((k, i) => m.set(k, i)); if (name === "edges") m.delete(half);
  for (let turn = 0; turn < 3; turn++) for (const k of sought) { say(name + " " + show(k) + " " + m.get(k) + m.has(k) + s.has(k)); if (turn === 1) { s.delete(k); m.delete(k); } if (turn === 2) { m.set(k, "new"); s.add(k); say(name + " " + show(k) + " " + m.get(k) + s.has(k) + m.size + s.size); } }
  say(name + fingerprint(s) + [...m].map(([k, v]) => show(k) + v).join());
}
let sum = 0; const byDouble = new Map(kinds.doubles(64).map((k, i) => [k, i])); for (let i = 0; i < 64; i++) { const v = byDouble.get(i * half + 0.25); if (v !== undefined) sum += v; if (byDouble.has(i * half)) sum += 1000; } say("sum " + sum);
console.log("lines", lines, hash);
