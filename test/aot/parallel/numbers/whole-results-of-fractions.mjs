// A whole number that a sum, a difference or a product of fractions makes is a number like any other: as a key, an index, in a switch, a map, a text, a list, a view, against another one.
const log = [];
const three = Number("3"), whole = new Map([[0, "z"], [1, "o"], [2, "t"], [3, "h"], [4, "f"]]), seen = new Set([1, 2, 3]), names = ["zero", "one", "two", "three", "four"];
class Box { constructor(v) { this.v = v; } plus(x) { return this.v + x; } get() { return this.v; } }
const xs = [10, 20, 30, 40, 3, 2], ds = [0.5, 1.5, 2, 3, 4.5], bs = new Uint8Array([9, 8, 7, 3, 2]), fs = new Float64Array([0.5, 1, 2, 3]), text = "abc3def2", keyed = { 0: "k0", 1: "k1", 2: "k2", 3: "k3" }, holey = [, 1, , 3], mixed = ["a", 3, 2.5, 2, null];
function same(x) { return x; }
function plus(a, b) { return a + b; }
function less(a, b) { return a < b; }
function times(a, b) { return a * b; }
function pick(x) { switch (x) { case 0: return "c0"; case 1: return "c1"; case 2: return "c2"; case 3: return "c3"; case 4: return "c4"; case 5: return "c5"; default: return "d"; } }
function table(x) { let r = 1; switch (x) { case 1: r += 1; case 2: r += 2; break; case 3: r += 3; case 4: r += 4; break; case 1000: r = 9; } return r; }
function sumTo(x) { let s = 0; for (let j = 0; j < x && j < 50; j++) s += j; return s; }
function down(x) { let s = 0; for (let j = x; j > 0 && s < 50; j--) s += j; return s; }
function fill(x) { const a = [1, 2, 3]; a.fill(x); return a[0] + a[2] + "/" + a.length; }
function stores(x) { const a = [1, 2, 3, 4], b = new Int32Array(4), c = new Float64Array(4), d = [0.5, 1.5]; a[0] = x; a[1] = x + 1; b[0] = x; c[0] = x; d[0] = x; a.push(x); return a[0] + a[4] + b[0] + c[0] + d[0] + "/" + a.join(); }
function steps(x) { let y = x; y++; let z = x; z--; let w = x; const q = w++; let e = x; const f = --e; return y + "," + z + "," + q + "," + w + "," + f + "," + e; }
function prefix(x) { const o = { y: x, l: [x] }; o.y++; ++o.l[0]; o.y += 2; o.l[0] -= 5; return o.y + "," + o.l[0]; }
function back(x) { let s = 0; for (let j = xs.length - 1; j >= x && j > -9; j--) s += xs[j]; return s; }
function phi(x) { let y = 0; for (let j = 0; j < 4; j++) { if (j === 2) y = x; y = y + 1; } return y; }
function nested(x) { let y; if (x > 1) y = x; else if (x > 0) y = x + 0.5; else y = -1; const z = y === 3 ? x : y; return z + y; }
function lists(x) { const a = []; for (let j = 0; j < 3; j++) a.push(j === 1 ? x : j); let s = 0; for (const y of a) s += y; return s + a.length; }
function fields(x) { const o = { n: 0, m: x }; for (let j = 0; j < 3; j++) { o.n = o.n + o.m; o.m = o.n; } return o.n; }
function setLength(x) { const a = [1, 2, 3, 4, 5]; if (x >= 0 && x < 10) a.length = x; return a.length; }
function compound(x) { let a = x, b = x, c = x, d = x, e = x; a *= 3; b /= 2; c %= 2; d <<= 2; e **= 2; return [a, b, c, d, e].join(); }
function asKey(x) { const o = {}; o[x] = x; o["p" + x] = 1; const m = new Map([[x, x]]); const s = new Set([x, 3, 0]); return Object.keys(o).join() + m.get(x) + m.get(3) + s.size; }
function forOf(x) { let s = 0; for (const y of [x, 1, x]) { s += y; s -= 1; } return s; }
function* gen(x) { yield x; yield x + 1; return x - 1; }
function generated(x) { let s = 0; for (const y of gen(x)) s = s * 10 + y; return s; }
function guarded(x) { try { if (x === 3) throw x; return x + 1; } catch (e) { return e + 1; } finally { x = x - 1; } }
function spread(x) { return Math.max(...[x, 1]) + plus(...[x, x]); }
function boxed(x) { const b = new Box(x); b.v += 1; b.v++; return b.plus(x) + b.get(); }
function flags(x) { return (x & 1 ? "a" : "") + (x & 2 ? "b" : "") + (x >> 1) + (x << 3) + (x ^ 7) + (x | 8) + (~x); }
function literal(x) { const { a, b: [c, d = 4] } = { a: x, b: [x] }; return a + c - d; }
function forIn(x) { let s = ""; for (const k in { [x]: 1, b: x }) s += k + x; return s; }
function holes(x) { const a = new Array(6); if (x >= 0 && x < 6) a[x] = x; let s = 0; for (let j = 0; j < 6; j++) s += a[j] === undefined ? 0 : a[j] + 1; return s; }
function tell(x) { return typeof x === "bigint" ? x + "n" : Object.is(x, -0) ? "-0" : typeof x === "string" ? JSON.stringify(x) : String(x); }
const half = JSON.parse("0.5"), quarter = half * half, one = half + half, tiny = JSON.parse("1e-300");
const makers = [
  () => half + half, () => half * 4, () => 2.5 + half, () => half * 8 - one + one, () => half - half, () => quarter * -0, () => -(half + half), () => half * 4294967296, () => half * 4294967294 * 2,
  () => half * -4294967296, () => quarter * 12 + half * 2 - 1, () => tiny * 0, () => half * 9007199254740992 * 2, () => half / 0 - half / 0, () => half / tiny / tiny,
];
const whole2 = new Map([[one, "one"], [half * 4, "two"], [half - half, "zero"]]), seen2 = new Set([half + half, half * 6]);
const i = 2;
const one_ = [
  X => X + 1,
  X => 1 + X,
  X => X - 1,
  X => 1 - X,
  X => X + i,
  X => i - X,
  X => X * 2,
  X => X * i,
  X => X / 2,
  X => 1 / X,
  X => X % 2,
  X => X ** 2,
  X => -X,
  X => +X,
  X => ~X,
  X => X | 0,
  X => X & 6,
  X => X ^ 5,
  X => X << 1,
  X => 1 << X,
  X => X >> 1,
  X => 255 >>> X,
  X => X >>> 0,
  X => X < 3,
  X => X <= i,
  X => X > 2.5,
  X => X >= 3,
  X => X === 3,
  X => X == 3,
  X => X !== 0,
  X => 3 === X,
  X => X === i + 1,
  X => X == "3",
  X => Object.is(X, -0),
  X => Object.is(X, 3),
  X => !X,
  X => X ? "y" : "n",
  X => X && 5,
  X => X || 7,
  X => X ?? 8,
  X => typeof X,
  X => xs[X],
  X => xs.at(X),
  X => ds[X],
  X => bs[X],
  X => fs[X],
  X => "abcdef"[X],
  X => text[X],
  X => text.charAt(X),
  X => text.charCodeAt(X),
  X => text.codePointAt(X),
  X => text.slice(X),
  X => text.substring(X, 5),
  X => text.repeat(X & 3),
  X => text.padEnd(X + 8, "."),
  X => text.indexOf(X),
  X => keyed[X],
  X => holey[X],
  X => xs.includes(X),
  X => xs.indexOf(X),
  X => xs.lastIndexOf(X),
  X => ds.includes(X),
  X => ds.indexOf(X),
  X => bs.indexOf(X),
  X => fs.includes(X),
  X => mixed.indexOf(X),
  X => mixed.includes(X),
  X => whole.has(X),
  X => whole.get(X),
  X => seen.has(X),
  X => X in xs,
  X => Object.hasOwn(xs, X),
  X => xs.slice(X).length,
  X => xs.slice(0, X).join(),
  X => xs.with(X & 3, X).join(),
  X => new Array(X & 7).length,
  X => Array.from({ length: X & 7 }, (_, j) => j + X).join(),
  X => new Int32Array([X])[0],
  X => new Uint8Array([X, X])[1],
  X => new Float64Array([X])[0],
  X => new Float32Array([X])[0],
  X => Int32Array.of(X, 1)[0],
  X => [X, 2].join(),
  X => [...[X]][0] + 1,
  X => [X].concat([X])[1] - 1,
  X => [X, 0.5].map(y => y + 1).join(),
  X => [X, 1].reduce((s, y) => s + y, 0),
  X => Math.max(X, 2),
  X => Math.min(X, i),
  X => Math.abs(X),
  X => Math.imul(X, 3),
  X => Math.floor(X),
  X => Math.sqrt(X),
  X => Math.trunc(X) + X,
  X => Math.sign(X),
  X => Math.pow(X, 2),
  X => Math.clz32(X),
  X => Math.hypot(X, 4),
  X => Math.round(X),
  X => `${X}`,
  X => "" + X,
  X => X + "",
  X => String(X),
  X => X.toString(),
  X => X?.toString(2),
  X => X.toFixed(1),
  X => JSON.stringify(X),
  X => JSON.stringify({ q: X, r: [X] }),
  X => Number(X),
  X => parseInt(X),
  X => Number.isInteger(X),
  X => Number.isInteger(X) ? X + 1 : 0,
  X => X == null,
  X => isNaN(X),
  X => plus(X, 1),
  X => plus(X, X),
  X => plus(i, X),
  X => less(X, i),
  X => times(X, X),
  X => pick(X),
  X => table(X),
  X => sumTo(X),
  X => down(X),
  X => same(X) + 1,
  X => (y => y + X)(X),
  X => ((a, b = X) => a - b)(X),
  X => ((...r) => r[0] + r.length)(X, X),
  X => new Box(X).plus(X),
  X => [X, X].sort((a, b) => a - b)[0] + 1,
  X => (i & 1 ? X : 1) + 1,
  X => (i > 5 ? 0.5 : X) + 1,
  X => (X === 3 ? X : i) + X,
  X => (X > 2 ? X : X + 1) - 1,
  X => (i ? X : "s") + 1,
  X => X === X,
  X => X + X,
  X => X - X,
  X => X * X,
  X => X / X,
  X => X < X,
  X => X & X,
  X => fill(X),
  X => stores(X),
  X => steps(X),
  X => prefix(X),
  X => back(X),
  X => phi(X),
  X => nested(X),
  X => lists(X),
  X => fields(X),
  X => setLength(X),
  X => compound(X),
  X => asKey(X),
  X => forOf(X),
  X => generated(X),
  X => guarded(X),
  X => spread(X),
  X => boxed(X),
  X => flags(X),
  X => literal(X),
  X => forIn(X),
  X => holes(X)
];
const two_ = [
  (X, Y) => X + Y,
  (X, Y) => X - Y,
  (X, Y) => X * Y,
  (X, Y) => X / Y,
  (X, Y) => X % Y,
  (X, Y) => X ** Y,
  (X, Y) => X | Y,
  (X, Y) => X & Y,
  (X, Y) => X << Y,
  (X, Y) => X >>> Y,
  (X, Y) => X < Y,
  (X, Y) => X <= Y,
  (X, Y) => X === Y,
  (X, Y) => X == Y,
  (X, Y) => X !== Y,
  (X, Y) => Object.is(X, Y),
  (X, Y) => plus(X, Y),
  (X, Y) => less(X, Y),
  (X, Y) => times(X, Y),
  (X, Y) => Math.max(X, Y),
  (X, Y) => [X, Y].indexOf(Y),
  (X, Y) => xs[X] + ds[Y],
  (X, Y) => X + Y + 1,
  (X, Y) => X - Y - 1,
  (X, Y) => (i ? X : Y) + 1,
  (X, Y) => X + (Y | 0),
  (X, Y) => (X | 0) + Y,
  (X, Y) => X + Y * 2,
  (X, Y) => X * 2 - Y,
  (X, Y) => -X + Y,
  (X, Y) => X + Y + "",
  (X, Y) => X && Y,
  (X, Y) => X ?? Y
];
for (let turn = 0; turn < 2; turn++) for (const make of makers) {
  const x = make();
  let line = tell(x) + ":";
  for (const run of one_) { let said; try { said = tell(run(x)); } catch (error) { said = error?.constructor?.name; } line += " " + said; }
  line += " | " + [whole2.get(x), whole2.has(x), seen2.has(x), new Map([[x, 1]]).get(Math.round(x)), new Set([x, Math.round(x)]).size, [x].includes(Math.round(x)), [Math.round(x)].indexOf(x), x === Math.round(x), Object.is(x, Math.round(x)), JSON.stringify([x, { x }]), `${x}`, Array.isArray(Array.from({ length: x === x && x < 9 && x > 0 ? x : 0 })), structuredClone([x]).map(tell)].join(" ");
  log.push(line);
  if (turn === 0) for (const other of makers) { const y = other(); let pair = ""; for (const run of two_) { let said; try { said = tell(run(x, y)); } catch (error) { said = error?.constructor?.name; } pair += said + " "; } log.push(pair); }
}
// Lists, views and counters that such numbers are stored into.
function fills(n) { const list = [1, 2, 3], ints = new Int32Array(3), fractions = []; for (let k = 0; k < 3; k++) { list[k] = n + n * k; ints[k] = n + k; fractions.push(n * 0.5); } return list.join() + ints.join() + fractions.join(); }
for (const n of [one, half * 4, half, half - half]) log.push(fills(n));
function steps(from, by, to) { let text = ""; for (let k = from; k < to; k += by) text += "abcdefghij"[k] + [10, 20, 30, 40, 50][k] + ","; return text; }
log.push(steps(half - half, half + half, 5), steps(0, half, 3), steps(one, one, 4));
function tables(n) { const counts = {}; for (let k = 0; k < 6; k++) { const key = k * n; counts[key] = (counts[key] || 0) + n; switch (key) { case 0: counts.zero = key; break; case 1: counts.one = key; break; case 2: counts.two = key; break; case 3: counts.three = key; } } return JSON.stringify(counts); }
for (const n of [one, half, half * 4]) log.push(tables(n));
function sorted(n) { return [3 * n, n, 2 * n, n + n].sort((a, b) => a - b).join() + [3 * n, 10 * n, 2 * n].sort().join() + Math.max(n, n * 2, 1) + Math.min(n - n, 0); }
for (const n of [one, half]) log.push(sorted(n));
function matrix(n) { const rows = [[n, n * 2], [n * 3, n * 4]]; let sum = n - n; for (let y = n - n; y < 2; y += one) for (let x = n - n; x < 2; x += one) sum += rows[y][x] * (x + y * n); return sum + rows[one][one] + "xyz"[sum % 3]; }
log.push(matrix(one), matrix(half));
// Narrowed by a switch or an equality, then boxed, then added again.
function made(value) { switch (value) { case 3: return { a: value, b: [value] }; } return { a: 0, b: [0] }; }
function equal(value) { if (value === 3) return { a: value, b: [value] }; return { a: 0.5, b: [0.5] }; }
for (let k = 0; k < 9; k++) { const p = made(k * half * 2 - one), q = equal(k * half + one); log.push([p.a + p.b[0], p.b[0] + 1, p.a - k, k + p.a, q.a + q.b[0], q.b[0] - k, [10, 20, 30, 40, 50][p.a], "abcde"[p.b[0]], p.a | 0, p.b[0] << 1, p.a === 3, new Map([[3, "t"]]).get(p.a), `${p.a}`].join(" ")); }
function carried(n) { let v = 0; const seen = []; for (let k = 0; k < 6; k++) { v = v + n; if (v === 2) seen.push(v); seen.push(seen.length ? seen[seen.length - 1] + v : v); } return seen.join(); }
log.push(carried(half), carried(one), carried(half * 4));
console.log(log.join("\n"));
