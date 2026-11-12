// Iterations that read and write other lists beside the one that they step through: of every kind and length, the same list twice, changed on the way.
const show = x => Object.is(x, -0) ? "-0" : Array.isArray(x) ? "[" + Array.from({ length: x.length }, (_, i) => i in x ? x[i] : "hole").map(show).join() + "]" : typeof x === "object" && x ? "{" + Object.keys(x).map(k => show(x[k])) + "}" : typeof x === "bigint" ? x + "n" : String(x);
function zip(L, M) { let s = 0, i = 0; for (const x of L) s += x * M[i++]; return s; }
function own(L, M) { let s = 0; for (const i of L.keys()) s += L[i]; return s; }
function others(L, M) { let s = 0; for (const i of L.keys()) s += M[i]; return s; }
function both(L, M) { let s = 0; for (const i of L.keys()) s += L[i] - M[i]; return s; }
function pairs(L, M) { let s = 0; for (const [i, x] of L.entries()) s += x * M[i]; return s; }
function copy(L, M) { let i = 0; for (const x of L) M[i++] = x; return [L, M]; }
function back(L, M) { let i = M.length; for (const x of L) M[--i] = x; return M; }
function swap(L, M) { for (const i of L.keys()) { const t = L[i]; L[i] = M[i]; M[i] = t; } return [L, M]; }
function grown(L, M) { let i = 0, s = 0; for (const x of L) { if (i < 3) M.push(x); s += M[i++]; if (i > 30) break; } return [s, M]; }
function cut(L, M) { let i = 0, s = 0; for (const x of L) { s += x + M[i]; if (++i === 2) L.length = 3; } return s; }
function replaced(L, M) { let i = 0, s = 0; for (const x of L) { s += x + M[i]; if (++i === 2) M = [7.5, "r", 9]; } return s; }
function nested(L, M) { let s = 0; for (const x of L) for (const i of M.keys()) s += x * M[i]; return s; }
function found(L, M) { let i = 0; for (const x of L) { if (x === M[i]) return i; i++; } return -1; }
function most(L, M) { let i = 0, m = -Infinity; for (const x of L) { if (M[i] > m) m = M[i]; i++; } return m; }
const lists = [() => [5, 3, 8, 1, 9, 2], () => [1.5, 0.5, NaN, -0], () => [1, , 3, , 5], () => [1.5, , 2.5], () => ["b", "a"], () => [1, "x", null, undefined, true], () => [], () => Object.freeze([1, 2, 3]), () => JSON.parse("[4,3.5,2]"), () => Float64Array.from([3, 1.5]), () => new Map([[0, 1], [1, 2]]), () => new Set([2, 1, 0]), () => "text", () => [1n, 2n], () => [2147483647, 2147483648, -1], () => Object.defineProperty([1, 2, 3], 1, { get() { return 5.5; }, configurable: true }), () => new (class extends Array {})(3).fill(2)];
for (let turn = 0; turn < 2; turn++)
  for (const list of lists)
    for (const other of lists)
      for (const run of [zip, own, others, both, pairs, copy, back, swap, grown, cut, replaced, nested, found, most]) {
        let said;
        try { const L = list(); said = show(run(L, turn && other === list ? L : other())); } catch (e) { said = "!" + e.constructor.name; }
        console.log(run.name, said.slice(0, 80));
      }
