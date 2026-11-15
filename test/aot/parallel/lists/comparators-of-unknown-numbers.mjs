// Elements that a copied comparator or predicate takes for numbers are expected to be numbers: one version for them, one for whatever they are.
// STATISTIC: ElementsComparedByCallees >= 1
function selectionSort(s, less) { const a = s.slice(); for (let i = 0; i < a.length; i++) { let m = i; for (let j = i + 1; j < a.length; j++) if (less(a[j], a[m])) m = j; const t = a[i]; a[i] = a[m]; a[m] = t; } return a; }
function largest(a, less) { let m = 0; for (let j = 1; j < a.length; j++) if (less(a[m], a[j])) m = j; return m; }
function compact(s, keep) { const a = s.slice(); let n = 0; for (let i = 0; i < a.length; i++) if (keep(a[i])) a[n++] = a[i]; a.length = n; return a; }
function quick(a, lo, hi, less) { while (lo < hi) { const p = a[(lo + hi) >> 1]; let i = lo, j = hi; while (i <= j) { while (less(a[i], p)) i++; while (less(p, a[j])) j--; if (i <= j) { const t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; } } if (j - lo < hi - i) { quick(a, lo, j, less); lo = i; } else { quick(a, i, hi, less); hi = j; } } return a; }
function merge(l, r, out, less) { let i = 0, j = 0, k = 0; while (i < l.length && j < r.length) out[k++] = less(l[i], r[j]) ? l[i++] : r[j++]; while (i < l.length) out[k++] = l[i++]; while (j < r.length) out[k++] = r[j++]; return out; }
function counts(a, keep) { let n = 0, s = 0; for (const x of a) { if (keep(x)) n++; else s += keep(x); } return [n, s]; }
const byField = process.argv.length > 90, less = byField ? (a, b) => a.v < b.v : (a, b) => a < b, keep = byField ? x => x.v > 2 : x => x % 2 > 0;
let log = []; const loud = n => ({ valueOf() { log.push(n); return n; } });
const kinds = {
  doubles: i => Math.sin(i * 7.3 + i * i), ints: i => (i * 7919 + i * i) % 1009, mixed: i => i % 5 ? i * 37 % 11 : i * 0.25, strings: i => "t" + i * 7919 % 101, some: i => i % 7 ? i * 13 % 29 : [undefined, null, "5", NaN, -0, true][i % 6],
  objects: i => loud(i * 31 % 17), big: i => i % 3 ? BigInt(i * 5 % 7) : i * 5 % 7, records: i => ({ v: i * 7 % 13 }),
};
const show = v => Object.is(v, -0) ? "-0" : typeof v === "object" && v ? "o" + (v.v ?? v.valueOf()) : typeof v === "bigint" ? v + "n" : String(v);
const attempt = f => { try { return f(); } catch (e) { return e.constructor.name; } };
for (let turn = 0; turn < 3; turn++) for (const name in kinds) for (const n of [0, 1, 2, 9, 40]) {
  const list = Array.from({ length: n }, (_, i) => kinds[name](i)), holes = list.slice(); if (n > 5) delete holes[3];
  const line = [selectionSort(list, less), largest(list, less), attempt(() => compact(list, keep)), quick(list.slice(), 0, list.length - 1, less), merge(list.slice(0, n >> 1), list.slice(n >> 1), new Array(n), less), attempt(() => counts(list, keep)), selectionSort(holes, less), attempt(() => compact(holes, keep))].map(x => Array.isArray(x) ? x.length + ":" + x.slice(-6).map(show) : show(x)).join(" ");
  console.log(turn, name, n, line, log.length, log.slice(-5).join()); log = [];
}
