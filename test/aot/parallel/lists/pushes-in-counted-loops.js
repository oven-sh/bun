// STATISTIC: PushesReservingForLoops >= 9
// A full array in a loop up to a bound takes capacity for what the remaining iterations push.
const out = [];
const show = a => { let t = a.length + ":"; for (let i = 0; i < a.length; i += Math.max(1, a.length >> 3)) t += (i in a ? String(a[i]) : "hole") + ","; return t + a[a.length - 1]; };
function numbers(n) { const a = []; for (let i = 0; i < n; i++) a.push(i * 2); return a; }
function several(n) { const a = []; for (let i = 0; i < n; i++) a.push(i, i + 1, "t" + i); return a; }
function runs(n) { const a = [], b = []; for (let i = 0; i < n; i++) a.push(i), a.push(i + 0.5), b.push(i, -i), a.push(-0); return show(a) + "|" + show(b); }
function upTo(n) { const a = [0.5]; for (let i = 1; i <= n; i++) a.push(i / 4); return a; }
function objects(n) { const a = []; for (let i = 0; i < n; i++) a.push({ i }); return a.map(o => o.i); }
class Bounds { constructor(n) { this.n = n; } fill() { const a = []; for (let i = 0; i < this.n; i++) a.push(i, i); return a; } }
function given(a, n) { for (let i = 0; i < n; i++) a.push(i); return a; }
function thrown(a, n) { try { for (let i = 0; i < n; i++) { if (i === 70) throw new Error("at 70"); a.push(i); } } catch (e) { out.push(e.message); } return a; }
function ended(a, n) { for (let i = 0; i < n; i++) { if (i === 70) break; a.push(i); } return a; }
function some(n) { const a = []; for (let i = 0; i < n; i++) if (i % 3) a.push(i); return a; }
function cut(n) { const a = []; for (let i = 0; i < n; i++) { a.push(i); if (i === 90) a.length = 3; if (i === 95) a[a.length + 2] = 1; } return a; }
for (const n of [0, 1, 5, 64, 65, 1000, 70000, "12", 7.5]) {
  out.push(show(numbers(n)), show(several(n)), runs(n), show(upTo(n)), show(objects(n)), show(new Bounds(n).fill()), show(some(n)), show(cut(n)));
  out.push(show(given([], n)), show(given([1, 2], n)), show(given(["a"], n)), show(thrown([], n)), show(ended([], n)));
}
const frozen = Object.freeze([1]); try { given(frozen, 3); } catch (e) { out.push(e.constructor.name); } out.push(show(frozen));
const closed = Object.preventExtensions([1]); try { given(closed, 3); } catch (e) { out.push(e.constructor.name); } out.push(show(closed));
class Kept extends Array {} out.push(given(new Kept(), 200) instanceof Kept, show(given(new Kept(1, 2, 3), 200)));
const seen = []; Object.defineProperty(seen, 2, { set(v) { out.push("set " + v); }, get() { return "got"; }, configurable: true }); seen.length = 1; out.push(show(given(seen, 5)));
const own = []; own.push = function (v) { this[0] = v; }; out.push(show(given(own, 300)));
out.push(show(given(new Proxy([], {}), 5)));
const twice = [[], []]; for (let k = 0; k < 2; k++) { const a = twice[k]; for (let i = 0; i < 300; i++) { a.push(i); twice[1 - k].push(-i); } } out.push(show(twice[0]), show(twice[1]));
console.log(out.join("\n"));
