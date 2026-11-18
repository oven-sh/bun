const late = (...parts) => parts.join(""), object = {}, symbol = Symbol();
const keys = () => [0, -0, 1, -1, 4 / 2, 2 ** 31, 0.5, NaN, "a", late("a", "b"), "x".repeat(20) + late("y"), object, {}, symbol, 5n, 2n ** 70n, true, null, undefined];
const entries = () => [[0, "zero"], [-1, 1], [2, 2], [2 ** 31, 3], [0.5, 4], [NaN, 5], ["ab", 6], ["x".repeat(20) + "y", 7], [object, 8], [symbol, 9], [5n, 10], [2n ** 70n, 11], [null, 12]];
globalThis.dump = c => [c.size, ...Array.from(c, it => (Array.isArray(it) ? it.map(show).join() : show(it)))].join("|");
const withMap = () => keys().map(k => [new Map(entries()), k]), withSet = () => keys().map(k => [new Set(entries().map(it => it[0])), k]);
check("(m, k) => [m.has(k), show(m.get(k))]", withMap);
check("(m, k) => [m.has(k), m.set(k, 'new') === m, m.has(k), m.get(k), m.delete(k), m.has(k), m.get(k), m.delete(k), dump(m)]", withMap);
check("(m, k) => dump(m.set(k, k))", withMap);
check("(s, k) => [s.has(k), s.add(k) === s, s.has(k), dump(s), s.delete(k), s.has(k), s.size]", withSet);
check("m => [m.get(0), m.get(-0), m.get(2), m.get('ab'), m.get(0.5), m.get(5n), m.has(NaN), m.has(null), m.has(undefined), m.get()]", () => [[new Map(entries())], [new Map()]]);
check("(n, f) => { const m = new Map(); let s = 0; for (let i = 0; i < n; i++) { m.set(f(i), i); if (i % 3 === 0) m.delete(f(i >> 1)); s += m.get(f(i)) ?? 100; s += m.size; } return s; }",
  () => [i => i, i => i / 2, i => "k" + i, i => (i & 1 ? i : String(i))].map(f => [70, f]));
check("(a, b, k) => { const before = a.get(k); b.set(k, 1); const after = a.get(k); b.clear(); return [before, after, a.get(k), a.size]; }", () => { const m = new Map(); return [[new Map(), new Map(), 1], [m, m, 1]]; });
check("(c, k) => [Map.prototype.has.call(c, k)]", () => [new Map([[1, 1]]), new (class extends Map {})([[1, 1]]), new Set([1]), new WeakMap(), {}, 5].map(c => [c, 1]));
check("c => c.size", () => [new Map([[1, 1]]), new Set([1, 2]), { size: 3 }, new (class extends Set { get size() { return 4; } })()].map(c => [c]));

const weakKeys = () => [object, {}, symbol, Symbol.for("k"), "a", 1, null, 5n];
check("(m, k) => [m.has(k), m.get(k)]", () => weakKeys().map(k => [new WeakMap([[object, 1], [symbol, 2], [{}, 3]]), k]));
check("(m, k) => [m.set(k, 7) === m, m.has(k), m.get(k)]", () => weakKeys().map(k => [new WeakMap([[object, 1]]), k]));
check("(s, k) => [s.has(k), s.add(k) === s, s.has(k)]", () => weakKeys().map(k => [new WeakSet([object]), k]));
check("n => { const m = new WeakMap(), kept = []; let s = 0; for (let i = 0; i < n; i++) { const k = {}; m.set(k, { i }); if (i % 9 === 0) kept.push(k); s += m.get(kept.at(-1)).i; } return s; }", () => [[10], [300]]);
const edits = () => [c => {}, c => c.clear(), c => c.delete(2), c => c.size < 9 && (c.add ?? c.set).call(c, c.size + 10, 0), c => { c.delete(1); c.delete(3); }, c => c.forEach(() => {})];
check("(c, edit) => { const seen = []; c.forEach((v, k, self) => { seen.push(v, k, self === c); edit(c); }); return seen; }",
  () => edits().flatMap(edit => [[new Map([[1, "a"], [2, 0.5], [3, {}]]), edit], [new Set([1, 2, 3]), edit]]).concat([[new Map(), () => {}], [new Set(), () => {}]]));
globalThis.divide = new Function("a", "b", "with (Math) return a / b;");
checkInTurn(k => { const m = new Map([[NaN, 1]]), s = new Set([NaN]); return [m.get(k), m.set(k, 2).size, s.has(k), s.add(k).size]; }, () => [["a"], [1.5], [divide(0, 0)], [-divide(0, 0)], [NaN]], 30);
