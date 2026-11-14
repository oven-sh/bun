// Loops fill one literal or several, by stores under their counter and by pushes: the arrays grow in the iterations.
// STATISTIC: StoresGrowingArrays >= 50
const veil = v => JSON.parse("0", () => v);
function both(n) { const p = [0.5], q = [0.5]; for (let i = 1; i < n; i++) { p[i] = i * 0.5; q[i] = i * 0.25; } return [p, q]; }
function either(x, n) { const p = [0.5], q = [0.5]; for (let i = 1; i < n; i++) { p[i] = x[i % x.length] * 2; q[i] = x[i % x.length] * 3; } return [p, q]; }
function above(x, n) { const p = [0.5], q = [0.5]; for (let i = 0; i < n; i++) { p[i + 1] = i * 0.5; q[i + 1] = x[i % x.length] * 0; } return [p, q]; }
function chained(n) { const a = [1], b = [2], c = [3]; for (let i = 1; i < n; i++) { a[i] = b[i - 1] + 1.5; b[i] = c[i - 1] - 0.5; c[i] = a[i] * 0.5; } return [a, b, c]; }
function bits(n) { const o = [1, 1]; for (let i = 2; i < n; i++) o[i] = (o[i - 1] + o[i - 2]) & 1023; return [o]; }
function least(x, n) { const d = [0]; for (let i = 1; i < n; i++) { let b = 1e9; for (let j = 1; j <= 4 && j <= i; j++) if (d[i - j] + x[j] < b) b = d[i - j] + x[j]; d[i] = b; } return [d]; }
function one(xs) { const a = []; for (let i = 0; i < xs.length; i++) { a.push(xs[i]); } return [a]; }
function pair(xs) { const a = [], b = [0.5]; for (let i = 0; i < xs.length; i++) { a.push(xs[i]); b.push(xs[i] * 2); } return [a, b]; }
function handled(xs, ys) { const a = [], b = [1]; let caught = 0; try { for (let i = 0; i < xs.length; i++) { a.push(xs[i]); b.push(ys[i] + 1); } } catch { caught = 1; } return [a, b, [caught]]; }
function inside(xs) { const out = []; for (let i = 0; i < xs.length; i++) { for (let q = 0; q < 2; q++) out.push(xs[i]); out.push(i); } return [out]; }
function sometimes(xs) { const out = [0.5]; for (let i = 0; i < xs.length; i++) { out.push(xs[i] * 2); if (i % 3 === 1) out.push(i); } return [out]; }
function beside(xs) { const out = [1]; for (let i = 0; i < xs.length; i++) { out.push(xs[i]); out[i] = i; } return [out]; }
function ends(xs) { const out = []; let s = 0; for (let i = 0; i < xs.length; i++) { s += out.push(xs[i]); if (i % 5 === 4) out.pop(); } return [out, [s]]; }
const thrower = { valueOf() { throw new Error("t"); } };
const many = Array.from({ length: 300 }, (_, i) => i + 0.5);
const lists = [veil([1, 2, 3, 4, 5]), veil([0.5, 1.5, 2.5]), [1, 2.5, "c"], [1, , 3], [1, undefined, 3], [-0, NaN, 2147483647], [thrower, 1], many, [], many.concat(["x", 1]), new Float64Array([1, 2.5])];
const say = all => all.map(v => v.length + "[" + Array.from(v.slice(0, 4), x => Object.is(x, -0) ? "-0" : typeof x === "object" ? "o" : String(x)).join() + "]" + (typeof v[v.length - 1] === "object" ? "o" : String(v[v.length - 1])) + Object.keys(v).length).join(" ");
for (const n of [0, 1, 2, 24, 25, 26, 400]) {
  console.log(n, say(both(n)), say(chained(n)), say(bits(n)));
  for (const x of lists) {
    for (const body of [either, above, least]) { let r; try { r = say(body(x, n)); } catch (e) { r = e.constructor.name; } console.log(body.name, r); }
  }
}
for (const xs of lists) {
  for (const body of [one, pair, inside, sometimes, beside, ends]) { let r; try { r = say(body(xs)); } catch (e) { r = e.constructor.name; } console.log(body.name, r); }
  for (const ys of lists) console.log("handled", say(handled(xs, ys)));
}
