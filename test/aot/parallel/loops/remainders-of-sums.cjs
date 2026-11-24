// Remainders of sums that come round loops: where the sign of zero is seen, where it is not, of negative terms, holes, doubles, and divisors of any kind.
function checksum(a) { let x = 1, y = 0; for (let i = 0; i < a.length; i++) { x = (x + a[i]) % 65521; y = (y + x) % 65521; } return (y << 16 | x) >>> 0; }
function seen(a, m) { let x = 0, z = 0; for (let i = 0; i < a.length; i++) { x = (x + a[i]) % 7; if (Object.is(x, -0)) z++; } return z + "|" + 1 / x; }
function kept(a) { const out = []; let x = -3; for (let i = 0; i < a.length; i++) { x = (x - a[i]) % 5; out.push(x); } return out; }
function passed(a) { let x = -4, y = -0; for (let i = 0; i < a.length; i++) { x = (x * 3 + a[i]) % 4; y = y + x; } return [y, 1 / y, x]; }
function rows(n, m) { const row = [1]; for (let i = 1; i < n; i++) { row.push(0); for (let j = i; j > 0; j--) row[j] = (row[j] + row[j - 1]) % m; } return row; }
function signed(row, m) { for (let i = 1; i < row.length; i++) row[i] = (row[i] - row[i - 1]) % m; return row; }
function divided(a, m) { let x = 5; for (let i = 0; i < a.length; i++) x = (x + a[i]) % m; return 1 / x + "|" + x; }
function text(a) { let s = "", x = -6; for (let i = 0; i < a.length; i++) { x = (x + a[i]) % 6; s += x + ","; } return s; }
function keys(a, t) { let x = 0, s = 0; for (let i = 0; i < a.length; i++) { x = (x + a[i] * 2) % 11; s += t[x] | 0; } return s; }
function compared(a) { let x = 0, n = 0; for (let i = 0; i < a.length; i++) { x = (x - a[i]) % 3; if (x === 0) n++; if (x < 0) n += 100; } return n; }
function negated(a) { let x = 0; for (let i = 0; i < a.length; i++) x = -((x + a[i]) % 4); return 1 / x; }
function nested(a) { let s = 0; for (let j = 0; j < 4; j++) for (let i = 0; i < a.length; i++) s = ((s * 31 + a[i]) % 1009 + j) % 97; return s; }
function chosen(a) { let x = -1, w = []; for (let i = 0; i < a.length; i++) { if (a[i] > 3) x = (x - a[i]) % 9; else if (a[i] === 2) { w.push(x); x = 0; } else x = x + 1; } return w.concat(x); }
function gcds(a) { let s = 0; for (let i = 0; i + 1 < a.length; i++) { let x = a[i], y = a[i + 1]; while (y) { const t = x % y; x = y; y = t; } s += x; } return 1 / s + "|" + s; }
function counted(a, d) { let z = 0, w = 0, x = 100; for (let i = 0; i < a.length; i++) { z += x % d; w = w + -x % (d | 1); d = d - 1 | 0; x = x + (a[i] | 0) | 0; } return [z, 1 / w, d]; }
function carried(a, s) { let z = s; for (let i = 0; i < a.length; i++) { const r = (z - a[i]) % 4; z = z + r; } return 1 / z; }
function entering(a) { let s = 0, t = -0, u = 0; for (let i = 0; i < a.length; i++) { const r = (a[i] - 4) % 3; s = s + r; t = t + r; u = r - u; } return [1 / s, 1 / t, 1 / u]; }
function show(x) { if (x === null || typeof x !== "object") return Object.is(x, -0) ? "-0" : String(x); let s = ""; for (let i = 0; i < x.length; i++) s += i in x ? (Object.is(x[i], -0) ? "-0" : String(x[i])) + " " : "- "; return s + x.length; }
const base = (k, n = 14) => Array.from({ length: n }, (_, i) => (i * 7 + k) % 11);
const lists = {
  ints: k => base(k), negative: k => base(k).map(v => v - 6), opposite: k => base(k).map(v => -v), zeros: () => [0, -0, 0, 0, -0, 0, -7, 0, -0, 7, 0, 0], doubles: k => base(k).map(v => v + .5), wide: k => base(k).map(v => Math.imul(v + 1, 0x9e3779b9) | 0), big: k => base(k).map(v => v * 2 ** 33), huge: k => base(k).map(v => v * 2 ** 60),
  holes: k => { const x = base(k); delete x[3]; return x; }, nan: k => { const x = base(k).map(v => v + .5); x[2] = NaN; return x; }, infinite: k => { const x = base(k).map(v => v + .5); x[4] = Infinity; return x; }, undef: k => { const x = base(k); x[5] = undefined; return x; }, texts: k => { const x = base(k); x[1] = "5"; return x; }, bigints: k => base(k).map(v => BigInt(v)), boxed: k => { const x = base(k); x[4] = "q"; x[4] = -7; return x; },
  words: k => Int32Array.from(base(k).map(v => v - 5)), floats: k => Float64Array.from(base(k)), bytes: k => Uint8Array.from(base(k)), one: () => [-7], none: () => [],
};
let all = 0; const note = (n, s) => { for (let i = 0; i < s.length; i++) all = Math.imul(all, 31) + s.charCodeAt(i) | 0; console.log(n, s.length > 150 ? s.slice(0, 100) + s.slice(-50) : s); };
const run = (n, f) => { let r; try { r = show(f()); } catch (e) { r = e.name; } note(n, r); };
for (const turn of [1, 2, 3]) for (const name of Object.keys(lists)) {
  const a = () => lists[name](turn);
  for (const f of [checksum, seen, kept, passed, text, compared, negated, nested, chosen, gcds, entering]) run(f.name + " " + name, () => f(a()));
  for (const d of [5, 3, 100, -1, 0]) run("counted " + name + d, () => counted(a(), d));
  run("keys " + name, () => keys(a(), base(3))); run("keys of " + name, () => keys(base(4), a()));
  for (const m of [7, 1, -3, 2.5, 0, 4294967296, NaN, "5"]) { run("carried " + name + m, () => carried(a(), m)); run("divided " + name + m, () => divided(a(), m)); run("signed " + name + m, () => signed(a(), m)); }
}
for (const m of [1000007, 7, 2, 1, 0, -5, 2 ** 53]) for (const n of [1, 5, 30, 70]) run("rows " + n + " " + m, () => rows(n, m));
console.log(all);
