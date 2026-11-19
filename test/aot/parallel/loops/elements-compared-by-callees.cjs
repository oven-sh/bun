// STATISTIC: ElementsComparedByCallees >= 14
// Written-out sorts whose comparator is handed in: the elements of an array nobody knows are read as numbers where the inlined comparator compares them. Integers, strings, holes, NaN, -0, big integers, objects with valueOf, comparators that change the array, views and frozen arrays give the answers of the written loop.
const show = value => value === undefined ? "u" : Object.is(value, -0) ? "-0" : Array.isArray(value) ? "[" + Array.from({ length: Math.min(value.length, 30) }, (_, i) => i in value ? show(value[i]) : "!").join() + "]" + value.length : ArrayBuffer.isView(value) ? "V" + Array.from(value).join() : typeof value === "object" && value ? "o" + value.v : typeof value === "bigint" ? value + "n" : String(value);
let touched, calls = 0;
function selection(a, less) { for (let i = 0; i < a.length; i++) { let m = i; for (let j = i + 1; j < a.length; j++) if (less(a[j], a[m])) m = j; const t = a[i]; a[i] = a[m]; a[m] = t; } return a; }
function insertion(a, less) { for (let i = 1; i < a.length; i++) { const x = a[i]; let j = i - 1; while (j >= 0 && less(x, a[j])) { a[j + 1] = a[j]; j--; } a[j + 1] = x; } return a; }
function heap(a, less) { const n = a.length; const down = (i, n) => { const x = a[i]; for (let k = 0; k < 40; k++) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && less(a[c], a[c + 1])) c++; if (!less(x, a[c])) break; a[i] = a[c]; i = c; } a[i] = x; }; for (let i = (n >> 1) - 1; i >= 0; i--) down(i, n); for (let e = n - 1; e > 0; e--) { const t = a[0]; a[0] = a[e]; a[e] = t; down(0, e); } return a; }
function partition(a, less, p) { let i = 0, j = a.length - 1, left = 60; while (i <= j && left-- > 0) { while (left-- > 0 && less(a[i], p)) i++; while (left-- > 0 && less(p, a[j])) j--; if (i <= j) { const t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; } } return [i, j, a]; }
function merge(a, less) { const r = a.slice(2), out = []; let i = 0, j = 0; while (i < a.length && j < r.length) out.push(less(a[i], r[j]) ? a[i++] : r[j++]); return out; }
function least(a, less) { let m = a[0], at = 0; for (let i = 1; i < a.length; i++) if (less(a[i], m)) { m = a[i]; at = i; } return [m, at]; }
function ascents(a, less) { let n = 0; for (let i = 0; i + 1 < a.length; i++) if (less(a[i], a[i + 1])) n++; return n; }
function halves(a, less, p) { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (less(a[m], p)) lo = m + 1; else hi = m; } return lo; }
const below = (a, b) => a < b, above = (a, b) => { if (touched && calls++ % 7 === 4) touched[calls % 5] = calls % 2 ? 0.25 : "late"; return a - b > 0; };
const over = (a, b) => a - b > 0, choose = k => k % 3 ? below : over, pick = k => k % 3 ? below : above;
let kind, change, k, seen;
const make = () => { const a = []; for (let i = 0; i < 9; i++) a.push(kind(i)); seen = a; change(a); return a; };
const sorts = {
  selection() { const a = make(); return selection(a, choose(k)); },
  insertion() { const a = make(); return insertion(a, pick(k)); },
  heap() { const a = make(); return heap(a, choose(k)); },
  partition() { const a = make(); return partition(a, pick(k), kind(4)); },
  merge() { const a = make(); return merge(a, choose(k)); },
  least() { const a = make(); return least(a, choose(k)); },
  ascents() { const a = make(); return ascents(a, choose(k)); },
  halves() { const a = make(); return halves(a, choose(k), kind(4)); },
};
const kinds = { real: i => Math.sin(i * 7 + 1), whole: i => (i * 5) % 7 - 3, text: i => "t" + (i * 7) % 5, object: i => ({ v: i, valueOf() { calls++; if (touched && calls % 9 === 3) touched[calls % 4] = 2; return (i * 7) % 5; } }), mixed: i => i % 3 ? i / 2 : "x" + i, zero: i => i % 4 ? -0 : 0, missing: i => (i * i) % 5 === 4 ? undefined : i - i * i / 2, big: i => i % 4 === 3 ? 10n : i, nan: i => i % 5 ? (i * 3) % 4 / 2 : NaN, large: i => 2 ** 31 + i * i % 9 };
const changes = { none() { }, hole(a) { delete a[2]; }, beyond(a) { a[11] = 1; }, frozen(a) { Object.freeze(a); }, kind(a) { a[2] = "other"; }, fraction(a) { a[4] = 0.5; }, touched(a) { touched = a; }, accessor(a) { Object.defineProperty(a, 2, { get() { return calls++ % 3; }, configurable: true }); }, heir(a) { Object.setPrototypeOf(a, { __proto__: Array.prototype, 3: 8 }); delete a[3]; }, short(a) { a.length = 4; } };
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
