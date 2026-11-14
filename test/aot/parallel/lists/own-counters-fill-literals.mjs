// Nested loops fill literals under counters of their own, and the outer loop reads what the inner one has stored.
// STATISTIC: StoresGrowingArrays >= 10
function inner(x, n) { const p = [0.5]; let s = 0, m = 0; for (let k = 0; k < n; k++) { s += p[m] * 2; for (let j = 0; j < x.length; j++) { m++; p[m] = p[m - 1] * 0.5 + x[j]; } s += p[m >> 1]; } return [p, s, m]; }
function outside(x, n) { const p = [0.5]; let s = 0, m = 0; for (let k = 0; k < n; k++) { s += p[m]; for (let j = 0; j < x.length; j++) { m++; p[m] = x[j]; } s += p[m >> 1]; } return [p, s, m]; }
function skips(x, n) { const p = [1]; let s = 0, m = 0; for (let k = 0; k < n; k++) { s += p.length; for (let j = 0; j < x.length; j++) { p[m] = j; m += j & 1 ? 2 : 1; } s += p[0]; } return [p, s, m]; }
function back(x, n) { const p = [0.5, 1.5]; let s = 0, m = 2; for (let k = 0; k < n; k++) { s += p[k >> 1]; for (let j = 0; j < x.length; j++) p[m++] = x[j] * 2; if (k === 4) m = 1; if (k === 6) p.length = 3; } return [p, s, m]; }
function two(x, n) { const p = [0.5], q = [1]; let s = 0, m = 0; for (let k = 0; k < n; k++) { s += p[m] + q[m]; for (let j = 0; j < x.length; j++) { m++; p[m] = x[j] * 0.5; q[m] = j; } } return [p, q, s, m]; }
function pops(x, n) { const p = [0.5]; let s = 0, m = 0; for (let k = 0; k < n; k++) { s += p[m]; for (let j = 0; j < x.length; j++) { m++; p[m] = x[j]; } if (k & 1) { p.pop(); m--; } } return [p, s, m]; }
const thrower = { valueOf() { throw new Error("no number"); } };
const lists = [[1, 2, 3], [0.5, 1.5], ["c", 1], [-0, NaN], [1, undefined, 2], [], [2147483647, -1, 5], [1, , 2], [1, thrower], Array.from({ length: 9 }, (_, i) => i * 0.25)];
const text = v => typeof v === "string" ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : v === thrower ? "thrower" : Array.isArray(v) ? "[" + v.length + ":" + Array.from({ length: v.length }, (_, i) => i in v ? text(v[i]) : "hole").join() + "]" : String(v);
for (let turn = 0; turn < 3; turn++) for (let k = 0; k < lists.length; k++) for (const f of [inner, outside, skips, back, two, pops]) for (const n of [0, 1, 8, 30]) {
  let said; try { said = text(f(lists[k], n)); } catch (e) { said = "threw " + e.message; }
  let h = 0; for (let i = 0; i < said.length; i++) h = (h * 31 + said.charCodeAt(i)) | 0;
  console.log(f.name, k, n, h, said.slice(0, 90));
}
