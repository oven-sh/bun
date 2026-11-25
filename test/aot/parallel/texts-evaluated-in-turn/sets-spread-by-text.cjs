// Text evaluated at run time spreads Sets of every kind of key into lists, calls and constructors: grown, with entries removed, emptied, of the program's constants, of keys that are numbers, texts, objects and mixtures, and stores into the list and the Set afterwards.
const hidden = t => [t, "0"][process.argv.length > 90 ? 1 : 0], F = (...a) => new Function(...a.slice(0, -1), hidden(a[a.length - 1]));
const lines = [];
const text = v => v === null ? "null" : typeof v === "function" ? "function" : typeof v === "object" ? "{" + Object.keys(v).join() + "}" : Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : typeof v === "symbol" ? v.toString() : typeof v === "string" ? JSON.stringify(v) : String(v);
const sum = list => { let k = 0; for (const c of list.map(text).join()) k = k * 31 + c.charCodeAt(0) | 0; return list.length + ":" + k; };
const object = { a: 1 }, symbol = Symbol("s"), constants = new Set(["one", "two", "three"]), numbers = new Set([1, 2, 3]);
const makes = {
  empty: () => new Set(), one: () => new Set(["x"]), integers: n => { const q = new Set(); for (let i = 0; i < n; i++) q.add(i * 3); return q; }, doubles: n => { const q = new Set(); for (let i = 0; i < n; i++) q.add(i + 0.5); return q; }, "large numbers": n => { const q = new Set(); for (let i = 0; i < n; i++) q.add(2147483640 + i); return q; }, texts: n => { const q = new Set(); for (let i = 0; i < n; i++) q.add("t" + i); return q; }, objects: n => { const q = new Set(); for (let i = 0; i < n; i++) q.add({ ["k" + i]: i }); return q; }, "numbers and texts": n => { const q = new Set(); for (let i = 0; i < n; i++) q.add(i & 1 ? i : "t" + i); return q; }, others: () => new Set([null, undefined, true, false, NaN, 0, 7n, symbol, object, "", "é", "ключ", 1e300, Infinity]), removed: n => { const q = new Set(); for (let i = 0; i < n; i++) q.add("t" + i); for (let i = 0; i < n; i += 3) q.delete("t" + i); return q; }, "removed at the end": n => { const q = new Set(); for (let i = 0; i < n; i++) q.add(i); for (let i = n >> 1; i < n; i++) q.delete(i); return q; }, "removed at the beginning": n => { const q = new Set(); for (let i = 0; i < n; i++) q.add(i); for (let i = 0; i < n - 1; i++) q.delete(i); return q; }, "all removed": n => { const q = new Set(); for (let i = 0; i < n; i++) q.add(i); for (let i = 0; i < n; i++) q.delete(i); return q; }, cleared: n => { const q = new Set(); for (let i = 0; i < n; i++) q.add(i); q.clear(); q.add("behind"); return q; }, "added again": n => { const q = new Set(); for (let i = 0; i < n; i++) q.add("t" + i); for (let i = 0; i < n; i += 2) { q.delete("t" + i); q.add("t" + i); } return q; }, constants: () => constants, "constants of numbers": () => numbers, "a copy": n => new Set(makes.texts(n)), "a subclass": n => { const q = new (class Keys extends Set { })(); for (let i = 0; i < n; i++) q.add("t" + i); return q; },
};
const spreads = {
  list: "return [...q];", "with others": "return [0, ...q, 'end'];", twice: "return [...q, ...q];", call: "return ((...l) => l)(...q);", "call with others": "return ((a, ...l) => [a, l.length, ...l])('first', ...q);", constructor: "class C { constructor(...l) { this.l = l; } } return new C(...q).l;", array: "return new Array('a', ...q);", max: "return [Math.max(...[...q].filter(x => typeof x === 'number'))];", "pushed": "const l = ['a']; l.push(...q); return l;", "of keys": "return [...q.keys()];", "of entries": "return [...q.entries()].map(e => e.length + ':' + (e[0] === e[1] || e[0] !== e[0]));", destructured: "const [a, b, ...l] = q; return [a, b, l.length, ...l];",
};
for (const [spread, code] of Object.entries(spreads)) {
  const f = F("q", code), seen = [];
  for (const [of, make] of Object.entries(makes)) for (const n of [3, 9, 100]) { const q = make(n), l = f(q), again = f(q); seen.push(of + " " + n + " " + sum(l) + (sum(l) === sum(again) ? "" : " then " + sum(again)) + " " + q.size); }
  lines.push(spread + ": " + sum(seen) + " " + seen[6] + " / " + seen[30] + " / " + seen[43]);
}
{ // the list and the Set are apart, and what a list holds stays alive
  const f = F("q", "const l = [...q]; l.push('more'); l[0] = 'changed'; l.sort(); q.add('added'); q.delete('t1'); return [l.length, l[0], l[l.length - 1], q.size, [...q].length, [...q].join().length];");
  lines.push("apart: " + [makes.texts(5), makes.texts(70), makes["numbers and texts"](9)].map(q => f(q).join()).join(" / "));
  const keep = F("n", "const kept = []; for (let i = 0; i < n; i++) { const q = new Set(); for (let k = 0; k < 12; k++) q.add({ i, k }); kept.push([...q]); } return kept;"), kept = keep(60);
  if (typeof Bun === "object") Bun.gc(true);
  lines.push("kept: " + kept.every((l, i) => l.length === 12 && l.every((o, k) => o.i === i && o.k === k)));
  const walk = F("q", "const it = q.values(); it.next(); const l = [...q]; q.delete(l[2]); q.add('late'); return [l.length, it.next().value, it.next().value, [...it].join()];");
  lines.push("walked meanwhile: " + walk(makes.texts(6)).join(" ") + " / " + walk(makes.integers(6)).join(" "));
}
{ // a Set whose own iteration is told
  const q = makes.integers(4); q[Symbol.iterator] = function* () { yield "own"; yield "iteration"; };
  lines.push("own: " + F("q", "return [...q, q.size].join();")(q));
  class Told extends Set { [Symbol.iterator]() { return ["told", "by", "the class"][Symbol.iterator](); } }
  lines.push("told: " + F("q", "return [...q, q.size].join();")(new Told([1, 2])));
}
console.log(lines.join("\n"));
