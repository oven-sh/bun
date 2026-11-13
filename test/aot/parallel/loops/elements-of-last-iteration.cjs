// Loops in which an iteration reads the element that the one before has stored: prefix sums, rows of tables, schedules, with stores in arms, aliases, calls and other stores in between.
var lib = { hook: null, kept: null };
function prefix(d, a, n) { for (var i = 1; i < n; i++) d[i] = d[i - 1] + a[i]; return d; }
function prefixInt(d, a, n) { for (var i = 1; i < n; i++) d[i] = d[i - 1] + a[i] | 0; return d; }
function suffix(d, a, n) { for (var i = n - 2; i >= 0; i--) d[i] = d[i + 1] * .5 + a[i]; return d; }
function schedule(d, a, n) { for (var i = 4; i < n; i++) d[i] = d[i - 4] ^ (d[i - 1] << 1 ^ d[i - 1] >>> 5) ^ a[i & 3]; return d; }
function row(d, a, n) { for (var i = 1; i < n; i++) { if (a[i] & 1) d[i] = a[i - 1]; else d[i] = Math.min(a[i], d[i - 1], a[i - 1]) + 1; } return d; }
function between(d, a, n) { for (var i = 1; i < n; i++) { d[i] = d[i - 1] + 1; a[i] = i * 3; } return d; }
function before(d, a, n) { for (var i = 1; i < n; i++) { a[i - 1] = i; d[i] = d[i - 1] + 2; } return d; }
function some(d, a, n) { for (var i = 1; i < n; i++) { if (a[i] > 4) d[i] = d[i - 1] + 1; } return d; }
function skips(d, a, n) { var s = 0; for (var i = 1; i < n; i++) { if (i === 5) continue; s += d[i - 1]; d[i] = d[i - 1] + a[i]; if (i === 9) break; } return s + "|" + show(d); }
function calls(d, a, n) { for (var i = 1; i < n; i++) { d[i] = d[i - 1] + 1; if (i === 4 && lib.hook) lib.hook(d, i); } return d; }
function ends(d, a, n) { for (var i = 1; i < n; i++) { d[i] = d[i - 1] + a[i]; if (i === 6) d.length = 3; } return d; }
function rows(t, n) { for (var j = 1; j < t.length; j++) for (var i = 1; i < n; i++) t[j][i] = t[j][i - 1] + t[j - 1][i]; return t; }
function tries(d, a, n) { var s = 0; for (var i = 1; i < n; i++) { d[i] = a[i] === 5 ? d[i - 1] + 1 : 7; try { s += d[i - 1]; } catch (e) { s = -1; } } return s + "|" + show(d); }
function twos(d, a, n) { for (var i = 2; i < n; i += 2) { d[i] = d[i - 2] + a[i]; d[i + 1] = d[i - 1]; } return d; }
function ahead(d, a, n) { for (var i = 0; i < n; i++) d[i + 1] = d[i] - a[i]; return d; }
"undefined" !== typeof module && module.exports && (module.exports = lib);
function show(x) { if (x && Array.isArray(x[0])) return x.map(show).join("/"); if (x === null || typeof x !== "object") return String(x); let s = ""; for (let i = 0; i < Math.min(x.length, 24); i++) s += i in x ? (Object.is(x[i], -0) ? "-0" : typeof x[i] === "object" ? "o" : String(x[i])) + " " : "- "; return s + x.length; }
const base = (k, n = 12) => Array.from({ length: n }, (_, i) => (i * 7 + k) % 11);
const lists = {
  ints: k => base(k), doubles: k => base(k).map(v => v + .5), wide: k => base(k).map(v => Math.imul(v, 0x9e3779b9) | 0), big: k => base(k).map(v => v + 2147483640), zeros: () => [0, -0, 0, -0, 0, 0, -0, 0, 0, 0, 0, 0], one: () => [7], none: () => [],
  holes: k => { const x = base(k); delete x[0]; delete x[4]; return x; }, holesOfDoubles: k => { const x = base(k).map(v => v + .25); delete x[3]; return x; }, nan: k => { const x = base(k).map(v => v + .25); x[0] = NaN; x[5] = NaN; return x; },
  boxed: k => { const x = base(k); x[5] = "q"; x[5] = 4; return x; }, texts: k => { const x = base(k); x[0] = "5"; return x; }, undef: k => { const x = base(k); x[2] = undefined; return x; }, bigints: k => base(k).map(v => BigInt(v)),
  frozen: k => Object.freeze(base(k)), getter: k => { const x = base(k); Object.defineProperty(x, 4, { get() { return 3; }, set(v) { lib.kept = v; }, configurable: true }); return x; }, readonly: k => Object.defineProperty(base(k), 5, { writable: false, value: 8 }),
  heir: k => (class extends Array { }).from(base(k)), inherits: k => { const x = base(k); delete x[3]; Object.setPrototypeOf(x, { __proto__: Array.prototype, 3: 77 }); return x; }, names: k => Object.assign(base(k), { "-1": 5 }),
  words: k => Int32Array.from(base(k)), bytes: k => Uint8Array.from(base(k)), floats: k => Float64Array.from(base(k)), proxy: k => new Proxy(base(k), {}), object: () => ({ 0: 1, 1: 2, length: 9 }), text: () => "0123456789",
};
let all = 0; const note = (n, s) => { for (let i = 0; i < s.length; i++) all = Math.imul(all, 31) + s.charCodeAt(i) | 0; console.log(n, s.length > 150 ? s.slice(0, 100) + s.slice(-50) : s); };
const run = (n, f) => { let r; try { r = show(f()); } catch (e) { r = e.name; } note(n, r); };
const forms = { prefix, prefixInt, suffix, schedule, row, between, before, some, skips, calls, ends, tries, twos, ahead };
for (const turn of [1, 2]) for (const name of Object.keys(lists)) for (const form of Object.keys(forms)) {
  lib.hook = turn === 1 ? null : (d, i) => { if (Array.isArray(d)) { d[i] = 50; d[i - 1] = 2.5; } };
  for (const n of [12, 14, 1, 7.5]) run(`${form} ${name} ${n}`, () => forms[form](lists[name](turn), lists.ints(turn + 2), n));
  const same = lists[name](3); run(`${form} ${name} same`, () => forms[form](same, same, 11));
  run(`${form} of ${name}`, () => forms[form](lists.ints(4), lists[name](turn), 11)); run(`${form} doubles of ${name}`, () => forms[form](lists.doubles(4), lists[name](turn), 11));
}
for (const name of Object.keys(lists)) { run(`rows ${name}`, () => rows([base(1), lists[name](2), base(3), lists[name](4)], 11)); const r = lists[name](1); run(`rows same ${name}`, () => rows([r, r, r], 11)); }
console.log(all);
