// Short lists made with a length whose reads and stores stay at positions that are not known until the program runs.
function dyn(x, i) { const r = new Array(4); for (let k = 0; k < r.length; k++) r[k] = x + k; return r[i & 3]; }
function dynStore(x, i) { const r = new Array(4); r[i & 3] = x; return (0 in r) + "," + (3 in r) + "," + r[i & 3] + "," + r.length; }
function dynBoth(x, i, j) { const r = new Array(8); r[i & 7] = x; r[j & 7] = x + 1; let s = 0; for (let k = 0; k < r.length; k++) s += r[k] === undefined ? 100 : r[k]; return s; }
function objects(x, i) { const r = new Array(3); for (let k = 0; k < 3; k++) r[k] = { v: x + k }; return r[i % 3].v; }
function nested(x) { const r = new Array(2); for (let a = 0; a < 2; a++) { const inner = new Array(2); for (let b = 0; b < 2; b++) inner[b] = x + a * 2 + b; r[a] = inner[0] + inner[1]; } return r[0] * 100 + r[1]; }
function conditional(x, c) { const r = new Array(3); if (c) r[0] = x; else r[2] = x; return [r[0], r[1], r[2]].join("|"); }
function* gen(x) { const r = new Array(3); for (let k = 0; k < r.length; k++) r[k] = x + k; yield r[1]; return r[2]; }
async function later(x, i) { const r = new Array(3); for (let k = 0; k < r.length; k++) r[k] = x + k; await 0; return r[i % 3]; }
function whileLoop(x) { const r = new Array(5); let k = 0; while (k < r.length) { r[k] = x * k; k++; } let s = ""; for (const v of [0, 1, 2, 3, 4]) s += r[v]; return s; }
function backwards(x) { const r = new Array(4); for (let k = r.length - 1; k >= 0; k--) r[k] = x - k; return r[0] + r[3] * 10; }
const out = [];
let sum = 0;
for (let i = 0; i < 20000; i++) sum += dyn(i & 3, i) + dynBoth(1, i, i >> 3) + objects(i & 1, i) + nested(i & 1) + backwards(i & 7);
out.push(sum, dyn(1, 2), dynStore(5, 3), dynStore(5, 0), dynBoth(1, 2, 2), objects(1, 5), nested(3), conditional(1, true), conditional(1, false), whileLoop(2), backwards(9));
const g = gen(4); out.push(g.next().value, g.next().value);
out.push(await later(7, 4));
const a = new Array(3); for (let k = 0; k < a.length; k++) a[k] = k; const b = new Array(3); for (let k = 0; k < b.length; k++) b[k] = k; const c = new Array(3); for (let k = 0; k < c.length; k++) c[k] = k;
out.push(a[process.argv.length % 3] + b[1] + c[2]);
console.log(JSON.stringify(out));
