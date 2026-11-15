// Arrays whose storage moves while loops hold other arrays, the same array under another name, and tables in nested loops.
// STATISTIC: StoresGrowingArrays >= 12
const veil = v => JSON.parse("0", () => v);
const said = []; let cases = 0;
function keep(...values) { cases++; let h = 0; const t = values.map(v => (Array.isArray(v) || ArrayBuffer.isView(v) ? v.length + ":" + Array.from(v).slice(0, 4).join() + ":" + v[v.length - 1] + ":" + Array.from(v).reduce((a, b) => (typeof b === "number" && b === b ? (a * 31 + b * 8) % 1000003 : a + 1), 0) : String(v))).join(" "); said.push(t); }
function other(x, n) { const p = [0]; let s = 0; for (let i = 0; i < n; i++) { p[i + 1] = p[i] + x[i % x.length]; s += x[(i * 7) % x.length]; } return [p, s]; }
function sameName(n, w) { const p = [0.5]; const q = veil(p); let s = 0; for (let i = 0; i < n; i++) { p[i + 1] = q[i] * 0.5 + w; s += q[i >> 1] + q.length; } return [p, s]; }
function sameHolder(n, w) { const p = [0.5], h = { list: p }; let s = 0; for (let i = 0; i < n; i++) { p[i + 1] = i * 0.25; s += h.list[i] + h.list.length; } return [p, s]; }
function nested(x, n) { const p = [0]; let s = 0; for (let k = 0; k < n; k++) { s += p[k >> 1]; for (let j = 0; j < 3; j++) p[k * 3 + j + 1] = p[k * 3 + j] + x[j]; } return [p, s]; }
function inner(x, n) { const p = [0.5]; let s = 0, m = 0; for (let k = 0; k < n; k++) { s += p[m] * 2; for (let j = 0; j < x.length; j++) { m++; p[m] = p[m - 1] * 0.5 + x[j]; } s += p[m >> 1]; } return [p, s]; }
function two(x, n) { const p = [0], q = [0]; let s = 0; for (let i = 0; i < n; i++) { p[i + 1] = p[i] + x[i % x.length]; q[i + 1] = q[i] - p[i + 1]; s += p[i >> 1] - q[i >> 1]; } return [p, q, s]; }
function three(n) { const a = [1], b = [2], c = [3]; for (let i = 1; i < n; i++) { a[i] = b[i - 1] + 1.5; b[i] = c[i - 1] - 0.5; c[i] = a[i] * 0.5; } return [a, b, c]; }
function called(x, n) { const p = [0.5]; let s = 0; const add = v => { p.push(v); return p.length; }; for (let i = 0; i < n; i++) { s += p[i] + x[i % x.length]; if (i % 3 === 0) add(i * 0.5); p[p.length] = s % 7; } return [p, s]; }
function method(x, n) { const p = [0.5]; let s = 0; for (let i = 0; i < n; i++) { p[i + 1] = x[i % x.length]; s += p.indexOf(p[i]) + p.at(-1); } return [p, s]; }
function made(n) { const all = []; for (let k = 0; k < n; k++) { const p = [k]; for (let j = 1; j < 40; j++) p[j] = p[j - 1] + j * 0.5; all.push(p); } return all.map(p => p[39]); }
function objects(n) { const p = [0.5]; const kept = []; for (let i = 0; i < n; i++) { p[i + 1] = i * 0.5; if (i % 16 === 0) kept.push({ v: p[i], list: [i, i + 1], text: "t" + i }); } return [p, kept.length, kept.map(k => k.v + k.list[1] + k.text.length)]; }
function whole(n) { const a = [1, 1]; let s = 0; for (let i = 2; i < n; i++) { a[i] = (a[i - 1] + a[i - 2]) & 1023; s = (s + a[i >> 1]) | 0; } return [a, s]; }
function down(x, n) { const p = [0]; let s = 0; for (let i = 0; i < n; i++) { p[i + 1] = x[x.length - 1 - (i % x.length)]; for (let j = i; j > i - 3 && j >= 0; j--) s += p[j]; } return [p, s]; }
function fails(x, n) { const p = [0.5], q = [0.5]; let s = 0; for (let i = 1; i < n; i++) { s = (s * 3 + p.length) % 1009; p[i] = i * 0.5; q[i] = x[i % x.length] * 0; } return [p, q, s]; }
function* yielded(x, n) { const p = [0]; let s = 0; for (let i = 0; i < n; i++) { p[i + 1] = p[i] + x[i % x.length]; s += p[i >> 1]; if (i % 97 === 5) yield s; } yield* p; }
async function awaited(x, n) { const p = [0]; let s = 0; for (let i = 0; i < n; i++) { p[i + 1] = p[i] + x[i % x.length]; s += p[i >> 1]; if (i % 500 === 5) await 0; } return [p, s]; }
const lists = [JSON.parse("[1,2,3,4,5]"), JSON.parse("[0.5,1.5,2.5]"), [1.5, Infinity, 2.5, 1], [1, "t", 3], [1, , 3], new Float64Array([0.25, 4])];
for (const n of [0, 1, 5, 40, 700, 5000]) {
  for (const x of lists) { keep("other", ...other(x, n)); keep("nested", ...nested(x, n)); keep("inner", ...inner(x, Math.min(n, 900))); keep("two", ...two(x, n)); keep("called", ...called(x, Math.min(n, 700))); keep("method", ...method(x, Math.min(n, 400))); keep("down", ...down(x, n)); keep("fails", ...fails(x, n)); keep("yielded", [...yielded(x, n)]); keep("awaited", ...(await awaited(x, n))); }
  for (const w of [0.5, 2, NaN, "t"]) { keep("sameName", ...sameName(n, w)); keep("sameHolder", ...sameHolder(n, w)); }
  keep("three", ...three(n)); keep("made", made(Math.min(n, 300))); keep("objects", ...objects(n)); keep("whole", ...whole(n));
}
console.log(cases); for (const t of said) console.log(t.slice(0, 160));
