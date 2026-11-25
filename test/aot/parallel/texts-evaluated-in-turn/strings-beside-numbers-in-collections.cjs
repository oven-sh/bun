// Text evaluated at run time asks, fills and empties Maps and Sets that hold numbers beside strings, objects and the rest: every kind of key, keys whose characters another string has, collections of every size, and collections of the program that get their first number late.
const hidden = t => [t, "0"][process.argv.length > 90 ? 1 : 0], F = (...a) => new Function(...a.slice(0, -1), hidden(a[a.length - 1]));
const lines = [];
const text = v => v === null ? "null" : typeof v === "function" ? "function" : typeof v === "object" ? "{" + Object.keys(v).join() + "}" : typeof v === "symbol" ? "symbol" : Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : typeof v === "string" ? JSON.stringify(v) : String(v);
const show = (name, v) => lines.push(name + ": " + v);
const sum = list => { let k = 0; for (const c of list.map(text).join()) k = k * 31 + c.charCodeAt(0) | 0; return k; };
const marks = [Symbol("a"), Symbol.iterator], things = [{ a: 1 }, [1], () => 1, new Date(0)];
const words = ["a", "b", "", "length", "0", "1", "1.5", "NaN", "long key with spaces in it", "ключ", "été", "__proto__", "x", "yy", "zzz", "constructor"];
const others = [0, -0, 1, 2, 1.5, NaN, Infinity, -1, 2 ** 31, 2 ** 53, null, undefined, true, false, 7n, 2n ** 70n, ...marks, ...things];
const forms = { itself: k => k, rope: k => k.slice(0, 1) + k.slice(1), piece: k => ("<" + k + ">").slice(1, -1), "piece that is wide": k => ("д" + k + "д").slice(1, -1), joined: k => [...k].join(""), json: k => JSON.parse(JSON.stringify(k)), boxed: k => new String(k), again: k => k.toUpperCase().toLowerCase(), atom: k => Object.keys({ [k + ""]: 1 })[0] };
const get = () => F("m", "k", "return m.get(k);"), has = () => F("m", "k", "return m.has(k);"), set = () => F("m", "k", "v", "return m.set(k, v) === m;"), add = () => F("m", "k", "return m.add(k) === m;"), remove = () => F("m", "k", "return m.delete(k);");
const makes = {
  "numbers first": () => { const m = new Map(); for (const k of [...others, ...words]) m.set(k, k); return m; },
  "strings first": () => { const m = new Map(); for (const k of [...words, ...others]) m.set(k, 1); return m; },
  few: () => new Map([[1, "one"], ["a", 2], ["b", "three"]]),
  "a number late": () => { const m = new Map([["a", 1], ["b", "two"], ["x", null], ["yy", undefined]]); m.set(5, 5); return m; },
  "a number that went": () => { const m = new Map([["a", 1], ["b", 2]]); m.set(5, 5); m.delete(5); return m; },
  twenty: () => { const m = new Map(); for (let i = 0; i < 20; i++) m.set(i & 1 ? i : "t" + i, "v" + i); m.set("a", "late"); return m; },
  hundreds: () => { const m = new Map(); for (let i = 0; i < 300; i++) m.set(i % 3 ? "h" + i : i, i); m.set("a", things[0]); return m; },
  "a thousand": () => { const m = new Map(); for (let i = 0; i < 1200; i++) m.set(i & 1 ? "k" + i : i * 1.5, i & 2 ? null : "n" + i); m.set("b", "end"); return m; },
  emptied: () => { const m = new Map([[1, 1], ["a", 1]]); m.clear(); return m; },
  empty: () => new Map(),
};
const sets = Object.fromEntries(Object.entries(makes).map(([n, f]) => [n, () => new Set(f().keys())]));
for (const [name, make] of Object.entries(makes)) for (const [form, f] of Object.entries(forms)) {
  const m = make(), g = get(), h = has(), seen = [];
  for (const k of [...words, "h1", "h298", "t0", "t18", "k1", "k1199", "absent"]) { const key = f(k); seen.push(h(m, key), g(m, key)); }
  show("read " + name + " " + form, sum(seen) + " " + seen.filter((v, i) => i & 1 && v !== undefined).length);
}
for (const [name, make] of Object.entries(makes)) for (const [form, f] of Object.entries(forms)) {
  const m = make(), q = sets[name](), s = set(), a = add(), d = remove(), dq = remove(), seen = [];
  for (const k of words) { seen.push(s(m, f(k), "new " + k), a(q, f(k))); }
  seen.push(m.size, q.size, ...m.keys());
  for (const k of ["b", "", "ключ", "long key with spaces in it", "absent", "t4", "h1", "k3"]) seen.push(d(m, f(k)), dq(q, f(k)), d(m, f(k)));
  for (const k of ["b", "ключ", "more", "t4"]) { seen.push(s(m, f(k), 1.5), a(q, f(k)), s(m, f(k), things[1])); }
  show("changed " + name + " " + form, sum(seen) + " " + sum([...m.keys(), ...m.values(), ...q]) + " " + m.size + " " + q.size);
}
for (const [name, make] of Object.entries(makes)) {
  const m = make(), q = sets[name](), g = get(), h = has(), s = set(), a = add(), d = remove(), seen = [];
  for (const k of others) seen.push(h(m, k), g(m, k), h(q, k), s(m, k, k), a(q, k), g(m, k), h(q, k));
  for (const k of others.filter((_, i) => i % 3)) seen.push(d(m, k), d(q, k), h(m, k));
  for (const k of others) seen.push(s(m, k, "again"), a(q, k));
  show("others " + name, sum(seen) + " " + sum([...m.keys(), ...q]) + " " + m.size);
}
{ // keys that outgrow their table while text adds them, strings and numbers in turn, with deletions and collections
  const m = new Map(), q = new Set(), s = set(), a = add(), g = get(), h = has(), d = remove(), seen = [];
  for (let i = 0; i < 900; i++) {
    s(m, i % 4 ? "key" + (i >> 2) : i, i % 5 ? i : "s" + i); a(q, i & 1 ? "w" + (i % 90) : i % 40);
    if (i % 7 === 0) seen.push(d(m, "key" + (i >> 3)), d(q, "w" + (i % 60)));
    seen.push(g(m, "key" + (i >> 4)), h(q, "w" + (i % 91)), h(m, i));
    if (i % 300 === 299 && typeof Bun === "object") Bun.gc(true);
  }
  show("in turn", sum(seen) + " " + sum([...m.keys(), ...m.values()]) + " " + sum([...q]) + " " + m.size + " " + q.size);
}
{ // a collection that is walked while text changes it
  const m = new Map([[1, 1], ["a", "x"], ["b", 2], [2, "y"]]), s = set(), d = remove(), seen = [];
  for (const [k, v] of m) { seen.push(k, v); if (k === "a") { s(m, "late", 3); d(m, "b"); } if (k === 2) s(m, "b", 4); if (m.size > 9) break; }
  show("walked", seen.map(text).join());
}
{ // one key cell over and over, and a key whose cell is another one each time
  const q = new Set(["a", "b", 0, 1]), h = has(), a = add(); let found = 0;
  for (let i = 0; i < 200; i++) { found += h(q, "a") + h(q, "a" + (i & 1 ? "" : "c")) + h(q, String.fromCharCode(97 + i % 3)); a(q, i % 32); a(q, "n" + i % 8); }
  show("over and over", found + " " + q.size);
}
show("constants", [F("q", 'let s = 0; for (let i = 0; i < 60; i++) { s += q.has("a") ? 1 : 0; q.add(i & 31); } return s + q.size;')(new Set(["a", "b"])), F("m", 'for (let i = 0; i < 60; i++) { m.set("n", (m.get("n") || 0) + 1); m.set(i & 7, m.get("n")); } return m.get("n") + m.get(3) + m.size;')(new Map([[9, 9]]))].join());
console.log(lines.join("\n"));
