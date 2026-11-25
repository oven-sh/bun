// Loops fill two literals or three by stores under their counter. The first store of an iteration is undone where a later one leaves.
// STATISTIC: IndexedStoresCompiledAsAppends >= 12
function short(x) { const p = [0.5], q = [0.5]; for (let i = 1; i < 24; i++) { p[i] = i * 0.5; q[i] = x[i % x.length]; } return [p, q]; }
function three(x) { const a = [1], b = [2], c = [3]; for (let i = 1; i < 20; i++) { a[i] = i; b[i] = i * 2; c[i] = x[i % x.length]; } return [a, b, c]; }
function reads(x) { const p = [0.5], q = [1.5]; for (let i = 1; i < 25; i++) { p[i] = q[i - 1] * 0.5; q[i] = p[i] + x[i % x.length]; } return [p, q]; }
function empty(x) { const p = [], q = []; for (let i = 0; i < 24; i++) { p[i] = i; q[i] = x[i % x.length] * 2; } return [p, q]; }
function leaves(x) { const p = [0.5], q = [0.5]; for (let i = 1; i < 24; i++) { p[i] = i * 0.25; if (x[i % x.length] === "c") break; q[i] = i * 2; } return [p, q]; }
function lengths(x) { const p = [0.5], q = [0.5]; let s = 0; for (let i = 1; i < 24; i++) { s = (s * 7 + p.length * 3 + q.length) % 100003; p[i] = i * 0.5; q[i] = x[i % x.length]; } return [p, q, [s]]; }
function grows(x, n) { const p = [0.5], q = [0.5]; for (let i = 1; i < n; i++) { p[i] = i * 0.5; q[i] = x[i % x.length]; } return [p, q]; }
function one(n, w) { const a = [0.5]; for (let i = 1; i < n; i++) a[i] = i * w; return [a]; }
function handled(x) { const p = [0.5], q = [0.5]; let caught = "none"; try { for (let i = 1; i < 24; i++) { p[i] = i; q[i] = +x[i % x.length]; } } catch (e) { caught = e.message; } return [p, q, [caught]]; }
const thrower = { valueOf() { throw new Error("no number"); } };
const lists = [[1, 2, 3], [0.5, 1.5], [1, 2, 3, 4, 5, 6, 7, "c"], [-0, NaN], [1, undefined, 2], [2147483647, -1], [1, 2, 3, 4, 5, 6, 7, 8, 9, thrower], [1.5, "t", 2], [1, , 2]];
const text = v => typeof v === "string" ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : v === thrower ? "thrower" : String(v);
function show(name, made) { for (const list of made) { let r = list.length + ":"; for (let i = 0; i < list.length; i++) r += (i in list ? text(list[i]) : "hole") + ","; let h = 0; for (let i = 0; i < r.length; i++) h = (h * 31 + r.charCodeAt(i)) | 0; console.log(name, h, r.slice(0, 90)); } }
for (let turn = 0; turn < 3; turn++) {
  for (let k = 0; k < lists.length; k++) {
    for (const f of [short, three, reads, empty, leaves, lengths, handled]) { try { show(f.name + " " + k, f(lists[k])); } catch (e) { console.log(f.name, k, "threw", e.message); } }
    for (const n of [0, 2, 8, 25, 26, 27, 90]) show("grows " + k + " " + n, grows(lists[k], n));
  }
  for (const n of [0, 1, 24, 25, 26, 60]) for (const w of [1, 0.5, NaN]) show("one " + n + " " + w, one(n, w));
}
