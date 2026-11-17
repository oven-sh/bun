// Loops store into array literals under a counter that steps up: the store at the end appends, and the array grows many times.
// STATISTIC: StoresGrowingArrays >= 8
// STATISTIC: LoopVersioningAttemptsFailed = 0
function prefix(x) { const p = [0]; for (let i = 0; i < x.length; i++) p[i + 1] = p[i] + x[i]; return p; }
function table(x, n) { const d = [0]; for (let i = 1; i < n; i++) { let b = 1e9; for (let j = 1; j <= 4 && j <= i; j++) if (d[i - j] + x[j] < b) b = d[i - j] + x[j]; d[i] = b; } return d; }
function fibonacci(n) { const o = [1, 1]; for (let i = 2; i < n; i++) o[i] = (o[i - 1] + o[i - 2]) & 1023; return o; }
function filled(n, w) { const o = [0.5]; for (let i = 0; i < n; i++) o[i] = w; return o; }
function scaled(n, w) { const o = [1]; for (let i = 1; i < n; i++) o[i] = (o[i - 1] * w) % 97; return o; }
function measured(n, w) { const o = [w * 1]; let s = 0; for (let i = 1; i < n; i++) { o[i] = o[i - 1] * 0.5 + w; s += o.length * o[i >> 1]; } return [o.length, s, o[o.length - 1]]; }
function shrinks(n, w) { const o = [0]; for (let i = 0; i < n; i++) { o[i] = w; if (i === 4) o.length = 2; } return o; }
function named(n, w) { const o = [0]; const other = { list: o }; let s = 0; for (let i = 0; i < n; i++) { o[i + 1] = w; s += other.list.length; } return [s, o]; }
function* yielded(x) { const p = [0]; for (let i = 0; i < x.length; i++) { p[i + 1] = p[i] + x[i]; if (i % 16 === 5) yield p.length; } yield p; }
async function awaited(n, w) { const o = [0.5]; for (let i = 0; i < n; i++) o[i + 1] = o[i] + w; await 0; return o; }
class Holder { fill(n, w) { const o = [w]; for (let i = 1; i < n; i++) o[i] = w; return o; } get list() { const o = [1]; for (let i = 1; i < this.n; i++) o[i] = o[i - 1] + this.w; return o; } }
const say = a => Array.isArray(a) ? a.length + "[" + Array.from(a.slice(0, 5), (v, i) => (Object.is(v, -0) ? "-0" : Array.isArray(v) ? say(v) : String(v))).join() + "]" + String(a[a.length - 1]) + Object.keys(a).length : String(a);
const many = []; for (let i = 0; i < 700; i++) many.push((i % 7) + 0.5);
const lists = [JSON.parse("[1,2,3,4,5,6,7]"), JSON.parse("[0.5,1.5,2.5]"), ["a", "b"], [1, undefined, 3], [1, , 3], [], [2147483647, 2147483647, 1], [NaN, 1], many, new Float64Array([1, 2.5]), "text"];
for (const x of lists) { console.log(say(prefix(x)), say(table(x, 40)), [...yielded(x)].map(say).join()); }
for (const n of [0, 1, 2, 3, 30, 900]) {
  console.log(n, say(fibonacci(n)));
  for (const w of [2, 0.5, -0, NaN, 2147483647, "t", undefined, null]) {
    const holder = new Holder(); holder.n = n; holder.w = w;
    console.log(say(filled(n, w)), say(scaled(n, w)), say(measured(n, w)), say(shrinks(n, w)), say(named(n, w)), say(await awaited(n, w)), say(holder.fill(n, w)), say(holder.list));
  }
}
for (const spoil of [o => Object.freeze(o), o => Object.seal(o), o => Object.preventExtensions(o), o => Object.defineProperty(o, "length", { writable: false }), o => Object.setPrototypeOf(o, { set 4(v) { console.log("set", v); } }), o => Object.defineProperty(o, 3, { get() { return 9; }, set(v) { console.log("stored", v); }, configurable: true }), o => { o.length = 100; }, o => { o[5000000] = 1; }, o => { o.push("t"); }]) {
  for (const w of [1, 0.5, "t"]) {
    let said;
    try { said = (() => { "use strict"; const o = [0.5]; spoil(o); for (let i = 0; i < 12; i++) o[i + 1] = w; return say(o); })(); } catch (error) { said = error.constructor.name; }
    console.log(said);
  }
}
{ const p = [0]; const x = lists[1]; for (let i = 0; i < x.length; i++) p[i + 1] = p[i] + x[i]; console.log(say(p)); }
