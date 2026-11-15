// STATISTIC: ExactCountersAskedOnce >= 2
// STATISTIC: StepsKeptAsIntegers >= 8
// Variables and captured variables that only count by one hold exact integers: they stop at 2^53, as a double does, in and outside unrolled loops. Every other number that is stored into such a place is read back as it is.
const out = [];
const told = v => Object.is(v, -0) ? "-0" : typeof v + String(v);
const say = (...values) => { out.push(values.map(told).join(" ")); };
const limit = 9007199254740992;
let up = 0, down = 0, both = 0, mixed = 0, late, wide = limit - 20;
function steps() { up++; down--; both += 1; both -= 1; both++; return up; }
function many(n) { for (let i = 0; i < n; i++) { up++; down -= 1; if (i & 1) both++; } }
function toLimit(n) { for (let i = 0; i < n; i++) wide++; }
function counter(n) { return { inc() { n++; }, dec() { n--; }, twice() { return ++n + n++; }, loop(k) { for (let i = 0; i < k; i++) n++; return n; }, back(k) { for (let i = 0; i < k; i++) n -= 1; return n; }, some(k) { for (let i = 0; i < k; i++) { if (i % 3 === 1) n++; } return n; }, each(list) { for (const x of list) n++; return n; }, until(m) { let k = 0; while (n < m && k < 40) { n++; k++; } return n; }, key: list => list[n++], get: () => n }; }
function holder(n) { return { inc() { n++; }, dec() { n--; }, twice() { return ++n + n++; }, loop(k) { for (let i = 0; i < k; i++) n++; return n; }, get: () => n, set(v) { n = v; } }; }
let low = 5 - limit, near = limit - 25, record = { n: limit - 9, m: 0 };
function lower(n) { for (let i = 0; i < n; i++) low--; }
function nearer(n) { for (let i = 0; i < n; i++) near++; return near; }
function bump(n) { for (let i = 0; i < n; i++) { record.n++; record.m--; } }
function alternate(n) { for (let i = 0; i < n; i++) { near++; near--; near++; } return near; }
for (let k = 0; k < 4; k++) { say(steps(), down, both); many(k * 9); say(up, down, both, up % 7, up / 2, up | 0, -up, down * down, `${up}`, up + 0.5, up === -down); }
for (let k = 0; k < 6; k++) { toLimit(7); say(wide, wide === limit, wide + 1, wide - 1, wide % 10); }
for (let k = 0; k < 5; k++) { lower(k + 1); say(low, nearer(k + 2)); bump(k + 3); say(record.n, record.m, alternate(k)); }
for (const start of [0, 5, -3, 2147483640, 4294967290, limit - 30, limit - 3, limit, -limit + 3, -limit]) {
  const c = counter(start);
  for (let k = 0; k < 3; k++) { c.inc(); say(c.twice(), c.get()); c.dec(); say(c.loop(9 + k), c.back(17), c.some(25), c.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), c.until(start + 30), c.key(["a", "b", "c", "d"]), c.get()); }
}
for (const value of [2.5, -0, NaN, "7", undefined, null, true, 1e300, limit + 2, Infinity, 3]) { const c = holder(1); c.set(value); say(c.get()); c.inc(); say(c.get()); c.dec(); say(c.get(), c.loop(10), c.twice()); }
function step(v) { mixed = v; mixed++; return mixed; }
for (const value of [1, 2.5, -0, "x", "9", limit, -limit, NaN, true, {}]) say(step(value), mixed);
function fill() { late = late === undefined ? 0 : late; late++; return late; }
for (let k = 0; k < 3; k++) say(fill(), late);
const closures = []; for (let i = 0; i < 3; i++) { let n = i; closures.push(() => { n++; return n; }, () => n); } for (const f of closures) say(f(), f());
const pair = counter(0), other = counter(10); function run(t) { for (let k = 0; k < t; k++) { pair.inc(); if (k & 1) other.inc(); } } run(101); say(pair.get(), other.get());
let sum = 0; for (let i = 0; i < out.length; i++) for (let k = 0; k < out[i].length; k++) sum = (sum * 31 + out[i].charCodeAt(k)) | 0;
console.log(out.slice(0, 40).join("\n")); console.log(out.length, sum >>> 0);
