// Math of constants read by name off objects that nobody types, in loops.
// STATISTIC: SiteCachedReadsHoisted >= 20
const said = []; let digest = 0, cases = 0, calls = 0;
const tells = process.argv[2] === "all";
function keep(text) { cases++; if (tells) console.log(text.slice(0, 260)); for (let i = 0; i < text.length; i++) digest = (digest * 31 + text.charCodeAt(i)) | 0; if (cases % 197 === 1) said.push(text.slice(0, 170)); }
function show(x) { try { return typeof x === "number" ? Object.is(x, -0) ? "-0" : String(x) : typeof x === "string" ? JSON.stringify(x) : typeof x === "bigint" ? x + "n" : x === undefined ? "u" : x === null ? "n" : x.length !== undefined ? "[" + Array.from({ length: Math.min(x.length, 9) }, (_, i) => i in x ? show(x[i]) : "_").join() + "]#" + x.length : typeof x; } catch (e) { return "!" + e.constructor.name; } }
const named = (names, values, o = {}) => { names.split(" ").forEach((n, i) => { o[n] = values[i]; }); return o; };
const got = (o, name, value) => Object.defineProperty(o, name, { get() { calls++; return value; }, configurable: true });
const turning = () => ({ valueOf() { calls++; return 2; } });
const values = [() => 3, () => 2.5, () => -0, () => NaN, () => Infinity, () => 2147483648, () => "4", () => "t", () => undefined, () => null, () => true, turning, () => 2n, () => Symbol("s"), () => [5], () => new Date(7), () => ({ valueOf() { throw new RangeError("v"); } })];
const shapes = [(a, b) => named("lo hi", [a, b]), (a, b) => got(named("hi", [b]), "lo", a), (a, b) => got(got({}, "lo", a), "hi", b), (a, b) => Object.create(named("hi lo", [b, a])), (a, b) => new Proxy(named("lo hi", [a, b]), { get(t, n) { calls++; return t[n]; } }), (a, b) => named("lo", [a])];
const lists = [() => [1, 2, 3, 4], () => [1.5, -2.5, 3.5, NaN], () => [0, -0, 5, -5], () => [1, "2", null, undefined], () => [1, , 3], () => [], () => new Float64Array([1, 2.5, -3]), () => [2n]];
function clamp(x, y, c) { for (let i = 0; i < x.length; i++) y[i] = Math.min(c.hi, Math.max(c.lo, x[i])); return y; }
function least(x, y, c) { let m = 9; for (let i = 0; i < x.length; i++) m = Math.min(m, c.lo); return m; }
function greatest(x, y, c) { let m = -9; for (let i = 0; i < x.length; i++) m = Math.max(c.hi, m); return m; }
function size(x, y, c) { let m = 0; for (let i = 0; i < x.length; i++) m += Math.abs(c.lo); return m; }
function down(x, y, c) { let m = 0; for (let i = 0; i < x.length; i++) m += Math.floor(c.hi) + i; return m; }
function power(x, y, c) { let m = 0; for (let i = 0; i < x.length; i++) m += Math.pow(c.lo, 2); return m; }
function product(x, y, c) { let m = 1; for (let i = 0; i < x.length; i++) m = Math.imul(c.lo, 3) + m | 0; return m; }
function far(x, y, c) { let m = 0; for (let i = 0; i < x.length; i++) m += Math.hypot(c.lo, c.hi); return m; }
function same(x, y, c) { let m = 0; for (let i = 0; i < x.length; i++) m += Math.max(c.lo, c.lo); return m; }
function order(x, y, c) { let m = 0; for (let i = 0; i < x.length; i++) m += Math.max(c.hi, c.lo, x[i]); return m; }
function stored(x, y, c) { for (let i = 0; i < x.length; i++) { y[i] = Math.max(c.lo, x[i]); if (i === 1) c.lo = 100; } return y; }
function some(x, y, c) { let m = 0; for (let i = 0; i < x.length; i++) if (i & 1) m += Math.min(c.hi, i); return m; }
function lost(x, y, c) { let m = 0; for (let i = 0; i < x.length; i++) { m += Math.min(c.hi, i); if (i === 2) delete c.hi; } return m; }
const forms = [clamp, least, greatest, size, down, power, product, far, same, order, stored, some, lost];
let place = 0;
function tried(f, x, y, c) { calls = 0; let answer; try { answer = show(f(x, y, c)); } catch (e) { answer = e.constructor.name; } keep(f.name + " " + answer + show(y) + calls); }
for (const f of forms) for (const x of lists) for (const a of values) for (const b of values) { if (place++ % 2) continue; tried(f, x(), place % 3 ? [0, 0, 0, 0] : [0.5, 0.5, 0.5, 0.5], shapes[place % 7 % shapes.length](a(), b())); }
console.log(cases, digest); for (const x of said) console.log(x);
