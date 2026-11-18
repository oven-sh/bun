// STATISTIC: ElementMovesInline >= 5
// Elements that move within one array of unknown kind in loops that call and in recursive functions. Integers, doubles, strings, objects, holes, NaN, -0, big integers, frozen, sparse and proxied arrays, views, subclasses, array-likes, keys outside, between and below give the answers of the written statements.
const show = value => value === undefined ? "u" : Object.is(value, -0) ? "-0" : Array.isArray(value) ? "[" + Array.from({ length: Math.min(value.length, 30) }, (_, i) => i in value ? show(value[i]) : "!").join() + "]" + value.length : ArrayBuffer.isView(value) ? "V" + Array.from(value).join() : typeof value === "object" && value ? "o" + Object.keys(value).map(key => key + show(value[key])).join("/") : typeof value === "bigint" ? value + "n" : String(value);
let calls = 0, touched;
function tick(i) { calls++; if (touched && calls % 7 === 4) touched[calls % 4] = calls % 2 ? 0.25 : "late"; return i; }
function front(a, n) { for (let e = n - 1; e > 0; e--) { const t = a[0]; a[0] = a[e]; a[e] = t; tick(e); } return a; }
function pairs(a, n) { for (let i = 0; i + 1 < n; i++) { [a[i], a[i + 1]] = [a[i + 1], a[i]]; tick(i); } return a; }
function permute(a, n) { if (n <= 1) { tick(n); return; } for (let i = 0; i < n; i++) { permute(a, n - 1); const k = n & 1 ? 0 : i; const t = a[k]; a[k] = a[n - 1]; a[n - 1] = t; } }
function rotate(a, n) { for (let i = 2; i < n; i++) { const t = a[i - 2]; a[i - 2] = a[i - 1]; a[i - 1] = a[i]; a[i] = t; tick(i); } return a; }
function pull(a, n) { for (let i = 1; i < n; i++) { a[i - 1] = a[i]; tick(i); } return a; }
function swap(a, i, j) { const t = a[i]; a[i] = a[j]; a[j] = t; }
function between(a, n) { for (let i = 0; i < n; i++) { swap(a, i, tick(n - 1 - i)); tick(i); } return a; }
class Strict { static ends(a, n) { for (let i = 0; i < n; i++) { const t = a[i]; a[i] = a[n]; a[n] = t; tick(i); } return a; } }
const moves = { front, pairs, permute(a, n) { permute(a, Math.min(n, 4)); }, rotate, pull, between, ends: Strict.ends };
const kinds = { real: i => Math.sin(i * 7 + 1), whole: i => (i * 5) % 7 - 3, text: i => "t" + (i * 7) % 5, object: i => ({ v: i }), mixed: i => i % 3 ? i / 2 : "x" + i, zero: i => i % 4 ? -0 : 0, missing: i => (i * i) % 5 === 4 ? undefined : i, big: i => i % 4 === 3 ? 10n : i, nan: i => i % 5 ? (i * 3) % 4 / 2 : NaN, large: i => 2 ** 31 + i };
const changes = {
  none: a => a, hole(a) { delete a[2]; return a; }, beyond(a) { a[11] = 1; return a; }, frozen: a => Object.freeze(a), sealed: a => Object.seal(a), kind(a) { a[2] = "other"; return a; }, fraction(a) { a[4] = 0.5; return a; }, touched: a => touched = a,
  accessor: a => Object.defineProperty(a, 2, { get() { return calls++ % 3; }, set(v) { calls += 5; }, configurable: true }), fixed: a => Object.defineProperty(a, 1, { writable: false }), above(a) { delete a[3]; return Object.setPrototypeOf(a, { __proto__: Array.prototype, get 3() { calls += 3; return 8; }, set 3(v) { calls += 7; } }); }, short(a) { a.length = 4; return a; },
  view: a => Float64Array.from(a, Number), proxy: a => new Proxy(a, { get(t, k, r) { calls++; return Reflect.get(t, k, r); }, set(t, k, v, r) { calls += 2; return Reflect.set(t, k, v, r); } }), heir: a => class extends Array { }.from(a), like: a => ({ ...a, length: a.length }), sparse(a) { a[2 ** 20] = 1; return a; }, text: a => "abcdefgh", nothing: a => null, literal: a => [1, 2, 3, 4, 5, 6], decimal: a => [0.5, 1.5, 2.5, 3.5],
};
for (const move in moves) {
  const out = [];
  for (const name in kinds) for (const changed in changes) {
    touched = undefined;
    let a = [];
    for (let i = 0; i < 8; i++) a.push(kinds[name](i));
    let text = "";
    try { a = changes[changed](a); text = show(moves[move](a, 7)); } catch (error) { text = error.constructor.name; }
    try { text += show(a); } catch (error) { text += error.constructor.name; }
    let sum = 0;
    for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0;
    out.push((sum >>> 0).toString(36));
  }
  console.log(move, out.join(" "), calls);
}
