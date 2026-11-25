const said = [];
// Sets and maps made of iterators over sets, maps and others; loops over maps that nothing proves.
function show(v) {
  if (v instanceof Map) return "M" + v.size + "{" + [...v].map(([k, x]) => show(k) + ">" + show(x)).join() + "}";
  if (v instanceof Set) return "S" + v.size + "{" + [...v].map(show).join() + "}";
  if (Array.isArray(v)) return "[" + v.map(show).join() + "]";
  return Object.is(v, -0) ? "-0" : typeof v === "string" ? JSON.stringify(v) : typeof v === "object" && v ? "o" + Object.keys(v) : String(v);
}
function attempt(name, f) {
  let a;
  try {
    a = show(f());
  } catch (e) {
    a = "threw " + e.constructor.name;
  }
  said.push(name + " " + a);
}
const o1 = { a: 1 },
  o2 = { b: 2 };
function tables() {
  const many = new Map();
  for (let i = 0; i < 300; i++) many.set(i * 7, "v" + (i % 11));
  const holes = new Map(many);
  for (let i = 0; i < 300; i += 3) holes.delete(i * 7);
  const prefix = new Set([1, 2, 3, 4, 5, 6]);
  prefix.delete(1);
  prefix.delete(2);
  return {
    empty: new Map(),
    ints: new Map([[1, 10], [2, 20], [3, 30]]),
    doubles: new Map([[1.5, 2.5], [-0, 1], [NaN, 2], [1e300, 3]]),
    texts: new Map([["a", "x"], ["b", "y"], ["a" + "b".repeat(9), "z"]]),
    mixed: new Map([[o1, 1], ["k", o2], [undefined, null], [10n, true]]),
    pairs: new Map([[[1, 2], [3, 4]], ["p", ["q", "r"]]]),
    many,
    holes,
    emptySet: new Set(),
    setInts: new Set([5, 6, 7]),
    setMixed: new Set([o1, "s", 1.25, null, NaN]),
    setPairs: new Set([[1, 2], ["a", "b"]]),
    prefix,
  };
}
const opens = { keys: t => t.keys(), values: t => t.values(), entries: t => t.entries(), own: t => t[Symbol.iterator](), itself: t => t };
const changes = {
  none() {},
  stepped(it) { if (it.next) it.next(); },
  steppedTwice(it) { if (it.next) { it.next(); it.next(); } },
  finished(it) { if (it.next) for (const x of it); },
  ownNext(it) { let n = 0; it.next = () => ({ done: n++ > 1, value: ["own", n] }); },
  ownReturn(it) { it.return = () => ({}); },
  ownIterator(it) { it[Symbol.iterator] = function () { return [["i", 1]][Symbol.iterator](); }; },
  proto(it) { Object.setPrototypeOf(it, { [Symbol.iterator]() { return [["q", 9]][Symbol.iterator](); }, next() { return { done: true }; } }); },
  deleted(it, t) { t.delete(2); t.delete("a"); t.delete(6); t.delete(7); },
  cleared(it, t) { t.clear(); },
  added(it, t) { if (t.add) t.add("added"); else t.set("added", "late"); },
  moved(it, t) { const k = t.keys().next().value; t.delete(k); if (t.add) t.add(k); else t.set(k, "moved"); },
  grown(it, t) { for (let i = 0; i < 40; i++) if (t.add) t.add("g" + i); else t.set("g" + i, i); },
};
const makes = {
  set: it => new Set(it),
  map: it => new Map(it),
  weak: it => { new WeakSet(it); return "weak"; },
  heir: it => new (class Heir extends Set {})(it),
  heirAdds: it => { const log = []; const s = new (class Heir extends Set { add(v) { log.push(show(v)); return super.add(v); } })(it); return [s.size, log.join()]; },
  setTwice: it => [new Set(it), new Set(it)],
  loop: it => { const l = []; for (const v of it) { l.push(v); if (l.length > 9) break; } return l; },
  loopPairs: it => { const l = []; for (const [a, b] of it) { l.push(a, b); if (l.length > 9) break; } return l; },
  loopFirst: it => { for (const [a, b] of it) return [a, b]; return "none"; },
  pattern: it => { const [a, b] = it; return [a, b]; },
  patternPairs: it => { const [[a, b], c] = it; return [a, b, c]; },
  spread: it => [...it],
  rest: it => { const [a, ...b] = it; return [a, b.length]; },
  from: it => Array.from(it).length,
};
for (let round = 0; round < 2; round++)
  for (const t of Object.keys(tables()))
    for (const o in opens)
      for (const c in changes)
        for (const m in makes) {
          attempt(`${round} ${t} ${o} ${c} ${m}`, () => {
            const table = tables()[t],
              it = opens[o](table);
            changes[c](it, table);
            return makes[m](it);
          });
        }
function nextOf(it) { return it.next().value; }
for (const t of Object.keys(tables())) attempt("after " + t, () => { const table = tables()[t], it = table.keys(); const s = new Set(it); return [s, it.next().done, nextOf(it), table.size]; });
let hash = 0;
said.forEach((line, i) => {
  for (let k = 0; k < line.length; k++) hash = (Math.imul(hash, 31) + line.charCodeAt(k)) | 0;
  if (i % 400 === 0) console.log(i, hash, line.slice(0, 120));
});
console.log(said.length, hash);
