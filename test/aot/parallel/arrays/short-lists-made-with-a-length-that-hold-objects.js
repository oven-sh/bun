// Short lists made with a length that hold objects, strings and mixed values, read and stored at positions known only when the program runs.
function dyn(x, i) { const r = new Array(4); for (let k = 0; k < r.length; k++) r[k] = { v: x + k }; return r[i & 3].v; }
function dynStore(x, i) { const r = new Array(4); r[i & 3] = "s" + x; return (0 in r) + "," + (3 in r) + "," + r[i & 3] + "," + r.length; }
function dynBoth(x, i, j) { const r = new Array(8); r[i & 7] = { v: x }; r[j & 7] = { v: x + 1 }; let s = 0; for (let k = 0; k < r.length; k++) s += r[k] === undefined ? 100 : r[k].v; return s; }
function mixed(x, i) { const r = new Array(3); r[0] = x; r[1] = "t" + x; r[2] = { x }; const got = r[i % 3]; return typeof got; }
function holesRead(x, i) { const r = new Array(5); r[1] = { x }; const got = r[i % 5]; return got === undefined ? "hole" : got.x; }
function twoLoops(x, n) { const r = new Array(6); for (let k = 0; k < r.length; k++) r[k] = "a" + k; let s = ""; for (let t = 0; t < n; t++) s += r[(t * 5 + x) % 6]; return s; }
function swapped(x, i, j) { const r = new Array(4); for (let k = 0; k < 4; k++) r[k] = "p" + (x + k); const t = r[i & 3]; r[i & 3] = r[j & 3]; r[j & 3] = t; return r[0] + r[1] + r[2] + r[3]; }
function rest() { var r = new Array(arguments.length); for (var k = 0; k < r.length; k++) r[k] = arguments[k]; return r.length + ":" + r[r.length - 1]; }
function restPicked(i) { var r = new Array(arguments.length); for (var k = 0; k < r.length; k++) r[k] = arguments[k]; return r[i % r.length]; }
function* gen(x, i) { const r = new Array(3); for (let k = 0; k < r.length; k++) r[k] = "g" + (x + k); yield r[i % 3]; return r[(i + 1) % 3]; }
async function later(x, i) { const r = new Array(3); for (let k = 0; k < r.length; k++) r[k] = { v: x + k }; await 0; return r[i % 3].v; }
function collected(x) { const r = new Array(8); for (let k = 0; k < r.length; k++) { r[k] = { v: [x, k] }; } let s = 0; for (let t = 0; t < 40; t++) s += r[t & 7].v[1] + new Array(3).length; return s; }
const out = [];
let sum = 0, text = "";
for (let i = 0; i < 20000; i++) { sum += dyn(i & 3, i) + dynBoth(1, i, i >> 3) + collected(i & 1); if ((i & 4095) === 0) text += mixed(i, i >> 12) + holesRead(i, i >> 12) + twoLoops(i & 3, 4) + swapped(i & 1, i >> 12, 2) + restPicked(i >> 12, "b", { c: 1 } && "c"); }
out.push(sum, text, dyn(1, 2), dynStore(5, 3), dynStore(5, 0), dynBoth(1, 2, 2), mixed(1, 0), mixed(1, 1), mixed(1, 2), holesRead(3, 1), holesRead(3, 4), twoLoops(1, 7), swapped(1, 0, 3), rest(), rest("x"), rest(1, "y", null), restPicked(1, "q"));
const g = gen(4, 1); out.push(g.next().value, g.next().value);
out.push(await later(7, 4));
const a = new Array(3); for (let k = 0; k < a.length; k++) a[k] = "k" + k; const b = new Array(3); for (let k = 0; k < b.length; k++) b[k] = "k" + k; const c = new Array(3); for (let k = 0; k < c.length; k++) c[k] = "k" + k;
out.push(a[process.argv.length % 3] + b[process.argv.length % 2] + c[2]);
console.log(JSON.stringify(out));
