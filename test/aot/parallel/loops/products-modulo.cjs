// Products and sums modulo a number in loops and in functions that are copied into loops: where the sign of zero is seen by the caller, where it is not, with zeros, negative factors, holes, fractions and numbers past int32.
function product(l) { let p = 1; for (let i = 0; i < l.length; i++) p = (p * (l[i] + 1)) % 10007; return p; }
function plain(l) { let p = 1; for (let i = 0; i < l.length; i++) p = (p * l[i]) % 1009; return p; }
function signed(l) { let p = 1, z = 0; for (let i = 0; i < l.length; i++) { p = (p * l[i]) % 7; if (Object.is(p, -0)) z++; } return z + "|" + 1 / p; }
function sums(l) { let s = -3; for (let i = 0; i < l.length; i++) s = (s + l[i]) % 5; return s; }
function mixed(l, m) { let s = 1; for (let i = 0; i < l.length; i++) s = (s * 31 + l[i]) % m; return s; }
function returned(l) { let p = 2; for (let i = 0; i < l.length; i++) { if (l[i] === 3) return p; p = (p * (l[i] - 2)) % 11; } return p; }
function past(l) { let p = 1; for (let i = 0; i <= l.length; i++) p = (p * (l[i] + 1)) % 10007; return p; }
function masked(l) { let p = 1; for (let i = 0; i < 9; i++) p = (p * 3 + l[(i * 7) & 15]) % 1009; return p; }
function ahead(l) { let p = 1; for (let i = 0; i < l.length; i++) p = (p * l[i] + l[i + 2]) % 97; return p; }
function downward(l) { let p = 1; for (let i = l.length; i >= -1; i--) p = (p * 5 + l[i] + 1) % 97; return p; }
function addedPast(l) { let n = 0; for (let k = 0; k < 3; k++) n += past(l) + masked(l) + ahead(l); return n; }
function added(l) { let n = 0; for (let k = 0; k < 5; k++) n += product(l); return n; }
function addedPlain(l) { let n = 0; for (let k = 0; k < 5; k++) n += plain(l); return n; }
function addedToZero(l) { let n = -0; for (let k = 0; k < 2; k++) n += plain(l); return 1 / n; }
function inverted(l) { let n = 0; for (let k = 0; k < 3; k++) n += 1 / plain(l); return n; }
function kept(l) { const out = []; for (let k = 0; k < 3; k++) out.push(plain(l), sums(l)); return out; }
function compared(l) { let n = 0; for (let k = 0; k < 3; k++) if (plain(l) === 0) n++; return n; }
function nested(l) { let n = 0; for (let k = 0; k < 3; k++) for (let j = 1; j < 4; j++) n += mixed(l, j * 7) * j; return n; }
function chained(l) { let n = 0; for (let k = 0; k < 3; k++) n += returned(l) - sums(l); return 1 / (n % 4); }
// Each callee has one call, and is copied into its loop.
function ofInverted(l) { let p = 1; for (let i = 0; i < l.length; i++) p = (p * l[i]) % 1009; return p; }
function invertedCopy(l) { let n = 0; for (let k = 0; k < 4; k++) n += 1 / ofInverted(l); return n; }
function ofZero(l) { let p = -1; for (let i = 0; i < l.length; i++) p = (p * l[i]) % 1009; return p; }
function zeroCopy(l) { let n = -0; for (let k = 0; k < 4; k++) n += ofZero(l); return 1 / n; }
function ofAdded(l) { let p = -1; for (let i = 0; i < l.length; i++) p = (p * l[i]) % 1009; return p; }
function addedCopy(l) { let n = 0; for (let k = 0; k < 4; k++) n += ofAdded(l); return n; }
function ofKept(l) { let p = 1; for (let i = 0; i < l.length; i++) p = (p * (l[i] - 3)) % 11; return p; }
function keptCopy(l) { const out = []; for (let k = 0; k < 4; k++) out.push(ofKept(l)); return out; }
function ofIs(l) { let s = -3; for (let i = 0; i < l.length; i++) s = (s + l[i]) % 3; return s; }
function isCopy(l) { let n = 0; for (let k = 0; k < 4; k++) if (Object.is(ofIs(l), -0)) n++; return n; }
function ofPast(l) { let p = 1; for (let i = 0; i <= l.length; i++) p = (p * 3 + l[i]) % 1009; return p; }
function pastCopy(l) { let n = 0; for (let k = 0; k < 4; k++) n += ofPast(l); return n; }
const show = x => Array.isArray(x) ? x.map(show).join() : Object.is(x, -0) ? "-0" : typeof x === "bigint" ? x + "n" : String(x);
const base = (k, n = 12) => { const a = []; for (let i = 0; i < n; i++) a.push((i * 7 + k) % 13); return a; };
const whole = { ints: k => base(k), from: k => Array.from({ length: 14 }, (_, i) => i * 7 % (11 + k)), negative: k => base(k).map(v => v - 6), opposite: k => base(k).map(v => -v), zeros: () => [0, 0, 5, 0], minus: () => [-1, 0, -3, 4], one: () => [-7], none: () => [], large: k => base(k).map(v => v * 100000007), wide: k => base(k).map(v => Math.imul(v + 1, 0x9e3779b9) | 0), tail: k => base(k).concat(2 ** 31) };
const any = { ...whole, negativeZero: () => [3, -0, 4], doubles: k => base(k).map(v => v + .5), huge: k => base(k).map(v => v * 2 ** 50), holes: k => { const x = base(k); delete x[3]; return x; }, nan: k => { const x = base(k); x[2] = NaN; return x; }, undef: k => { const x = base(k); x[5] = undefined; return x; }, texts: k => { const x = base(k); x[1] = "5"; return x; }, bigints: k => base(k).map(v => BigInt(v)), words: k => Int32Array.from(base(k).map(v => v - 5)), floats: k => Float64Array.from(base(k)) };
const few = [base(1), base(2).map(v => v - 6), [0, 0, 5, 0], [-1, 0, -3, 4], [-7], [], base(3).map(v => -v), [3, 0], [0, 3], base(4, 40)]; let seen = "";
for (let t = 0; t < 3; t++) for (const l of few) seen += [invertedCopy(l), zeroCopy(l), addedCopy(l), keptCopy(l), isCopy(l), pastCopy(l)].map(show).join(";") + " ";
console.log(seen);
let all = 0; const note = (n, s) => { for (let i = 0; i < s.length; i++) all = Math.imul(all, 31) + s.charCodeAt(i) | 0; console.log(n, s); };
const run = (n, f) => { let r; try { r = show(f()); } catch (e) { r = e.name; } note(n, r); };
for (const turn of [1, 2, 3]) for (const name of Object.keys(whole)) for (const f of [product, plain, past, masked, ahead, downward, addedPast, signed, sums, returned, added, addedPlain, addedToZero, inverted, kept, compared, nested, chained]) run(f.name + " " + name, () => f(whole[name](turn)));
function anyOf() {
  function product(l) { let p = 1; for (let i = 0; i < l.length; i++) p = (p * (l[i] + 1)) % 10007; return p; }
  function plain(l) { let p = 1; for (let i = 0; i < l.length; i++) p = (p * l[i]) % 1009; return p; }
  function added(l) { let n = 0; for (let k = 0; k < 5; k++) n += product(l); return n; }
  function inverted(l) { let n = 0; for (let k = 0; k < 3; k++) n += 1 / plain(l); return n; }
  return [product, plain, added, inverted];
}
for (const turn of [1, 2]) for (const name of Object.keys(any)) { for (const f of anyOf()) run("any " + f.name + " " + name, () => f(any[name](turn))); for (const m of [7, 1, -3, 2.5, 0, 4294967296]) run("mixed " + name + m, () => mixed(any[name](turn), m)); }
console.log(all);
