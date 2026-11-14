// STATISTIC: ElementSumsInline >= 8
// Numbers that go round a loop boxed, or come as integers whose conversion the sum's box makes, added to elements of arrays of unknown kind.
const out = []; let calls = 0; function tick() { calls++; if (calls === 1e9) out.push("never"); }
function around(a, n, start) { let x = start; for (let i = 0; i < n; i++) { a[i & 3] += x; x = a[(i + 1) & 3] + 0.5; tick(); } return x; }
function halves(a, n, start) { let x = start; for (let i = 0; i < n; i++) { a[i & 3] = a[i & 3] + x; x = i & 1 ? x / 2 : x * 3; tick(); } return x; }
function deep(a, d, x) { if (d < 0) return x; a[d & 3] += x; tick(); return deep(a, d - 1, x * 0.5) + deep(a, d - 2, x + 1); }
function grid(rows, n, m) { for (let j = 0; j < m; j++) { for (let k = 0; k < n; k++) { rows[k][j] += k + j; if (k === 9) rows.length = k; } } return String(rows); }
function steps(rows, n) { for (let k = 0; k < n; k++) { const r = rows[k]; r[0] += k * 2; r[1] -= k - 3; r[2] = k + 1 + r[2]; tick(); } return String(rows); }
const makes = [() => [1, 2, 3, 4], () => [0.5, 1.5, 2.5, 3.5], () => [2147483647, -2147483648, 1e300, -0], () => new Array(4).fill(7)];
for (const make of makes) for (const start of [1, 0.25, -0, NaN, 2147483647]) for (const f of [around, halves, deep]) { const a = make(); let r; try { r = f(a, 9, start); } catch (error) { r = error.constructor.name; } out.push([f.name, String(r), Array.from(a, v => Object.is(v, -0) ? "-0" : String(v)).join()].join(" ")); }
for (const make of makes) for (const other of makes) { let r; try { r = grid([make(), other(), [0, 0, 0, 0], new Array(4), make()], 5, 4) + steps([make(), other(), [1, 2, 3]], 3); } catch (error) { r = error.constructor.name; } out.push(r); }
let sum = 0; for (const line of out) for (let i = 0; i < line.length; i++) sum = (sum * 31 + line.charCodeAt(i)) | 0;
console.log(out.slice(0, 60).join("\n")); console.log(out.length, sum >>> 0);
