// STATISTIC: ElementsComparedByCallees >= 34
// Partitions whose inner loops only compare elements by a comparator handed in run in one version of the loop around. Integers, strings, holes, NaN, -0, big integers, objects with valueOf that change the array, frozen arrays, accessors, proxies and views give the answers of the written loop.
const show = value => value === undefined ? "u" : Object.is(value, -0) ? "-0" : Array.isArray(value) ? "[" + Array.from({ length: Math.min(value.length, 30) }, (_, i) => i in value ? show(value[i]) : "!").join() + "]" + value.length : ArrayBuffer.isView(value) ? "V" + Array.from(value).join() : typeof value === "object" && value ? "o" + value.v : typeof value === "bigint" ? value + "n" : String(value);
let touched, calls = 0;
function quick(a, lo, hi, less, left) {
  while (lo < hi && left > 0) {
    const p = a[(lo + hi) >> 1];
    let i = lo, j = hi;
    while (i <= j) {
      while (less(a[i], p) && i < 40) i++;
      while (less(p, a[j]) && j > -5) j--;
      if (i <= j) { const t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; }
      if (--left < 0) return a;
    }
    if (j - lo < hi - i) { quick(a, lo, j, less, left - 9); lo = i; } else { quick(a, i, hi, less, left - 9); hi = j; }
  }
  return a;
}
function split(a, p, less) { let i = 0, j = a.length - 1, left = 30; for (;;) { while (i < a.length && less(a[i], p)) i++; while (j >= 0 && !less(a[j], p)) j--; if (i >= j || left-- < 0) return [i, j, a]; const t = a[i]; a[i] = a[j]; a[j] = t; } }
function runs(a, less) { const ends = []; for (let i = 0; i < a.length;) { let j = i + 1; while (j < a.length && !less(a[j], a[j - 1])) j++; ends.push(j); i = j; } return ends; }
function ranks(a, less) { const n = []; for (let i = 0; i < a.length; i++) { let c = 0; for (let j = 0; j < a.length; j++) if (less(a[j], a[i])) c++; n.push(c); } return n; }
const below = (a, b) => a < b, above = (a, b) => b - a < 0, byField = (a, b) => (a ?? 0).v < (b ?? 0).v;
const choose = k => k % 4 === 3 ? byField : k % 2 ? above : below;
let kind, change, k, seen;
const make = () => { const a = []; for (let i = 0; i < 11; i++) a.push(kind(i)); seen = a; return seen = change(a); };
const sorts = {
  quick() { const a = make(); return quick(a, 0, a.length - 1, choose(k), 60); },
  split() { const a = make(); return split(a, kind(4), choose(k)); },
  runs() { const a = make(); return runs(a, choose(k)); },
  ranks() { const a = make(); return ranks(a, choose(k)); },
  known() { const a = []; for (let i = 0; i < 11; i++) a.push(kind(i)); seen = a; if (k % 5 === 1) delete a[3]; if (k % 5 === 2) touched = a; if (k % 5 === 3) a[2] = 0.5; return quick(a, 0, a.length - 1, choose(k), 60); },
};
const kinds = { real: i => Math.sin(i * 7 + 1), whole: i => (i * 5) % 7 - 3, text: i => "t" + (i * 7) % 5, object: i => ({ v: (i * 5) % 7, valueOf() { calls++; if (touched && calls % 9 === 3) touched[calls % 4] = calls % 2 ? 2.5 : "late"; return (i * 7) % 5; } }), mixed: i => i % 3 ? i / 2 : "x" + i, zero: i => i % 4 ? -0 : 0, missing: i => (i * i) % 5 === 4 ? undefined : i - i * i / 2, big: i => i % 4 === 3 ? 10n : i, nan: i => i % 5 ? (i * 3) % 4 / 2 : NaN, large: i => 2 ** 31 + i * i % 9 };
const changes = { none: a => a, hole: a => { delete a[2]; return a; }, beyond: a => { a[13] = 1; return a; }, frozen: a => Object.freeze(a), view: a => new Float64Array(a.map(Number)), kind: a => { a[2] = "other"; return a; }, fraction: a => { a[4] = 0.5; return a; }, touched: a => touched = a, accessor: a => Object.defineProperty(a, 2, { get() { return calls++ % 3; }, configurable: true }), heir: a => (class extends Array { }).from(a), proxy: a => new Proxy(a, {}), short: a => { a.length = 4; return a; } };
for (const sort in sorts) {
  const out = [];
  for (const name in kinds) for (const changed in changes) {
    touched = undefined;
    kind = kinds[name];
    change = changes[changed];
    k = out.length;
    let text = "";
    try { text = show(sorts[sort]()); } catch (error) { text = error.constructor.name; }
    try { text += show(seen); } catch (error) { text += error.constructor.name; }
    let sum = 0;
    for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0;
    out.push((sum >>> 0).toString(36));
  }
  console.log(sort, out.join(" "), calls);
}
