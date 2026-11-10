// STATISTIC: UnrolledLoopsWithReentry >= 1
export {};
const out: number[] = [], o = { n: 0 }, m = new Map<number, number>(), keyed: Record<string, number> = {};
let total = 0, last = -1, text = "", backs = 0, noted = 0;
function note(x: number): void { noted = (noted * 3 + x) | 0; if ((noted & 31) === 7) out.push(noted); }
function raise(x: number): void { if (x >= 0) throw x; }
function show(x: number): string { return Object.is(x, -0) ? "-0" : String(x); }
function drain(g: Generator<number, string>): string { let r = g.next(); while (!r.done) { out.push(r.value); r = g.next(); } return r.value; }
function make(n: number, marked: (i: number) => boolean): Float64Array { const t = new Float64Array(n); for (let i = 0; i < n; i++) { const v = marked(i) ? (i & 1 ? 13 : 10) : 97 + (i * 7) % 23; t[i] = v < 32 ? v : v + 0.5; } return t; }
function run(a: Float64Array, n: number): string { let s = 0, h = 0, k = 0; for (let i = 0; i < n; i++) { const c = a[i]; if (c < 32) { out.push(i); continue; } s = s + c; h = (h * 31 + c) | 0; } return show(s) + " " + show(h) + " " + show(k); }
function state(): string { let x = 0; for (const v of out) x = (x * 31 + v) | 0; const line = [out.length, out.slice(0, 4).join("_"), x, o.n, total, show(last), m.size, text.length, Object.keys(keyed).length, backs, noted].join(" ");
  out.length = 0; o.n = 0; m.clear(); for (const key of Object.keys(keyed)) delete keyed[key]; total = 0; last = -1; text = ""; backs = 0; noted = 0; return line; }
const marks: [string, (i: number) => boolean][] = [["none", () => false], ["all", () => true], ["by 64", i => (i & 64) !== 0], ["pairs", i => i % 31 === 29 || i % 31 === 30], ["quiet, then odd", i => i > 600 && (i & 1) === 1]];
for (const p of [0, 1, 7, 8, 9, 63, 64]) marks.push(["at " + p, i => i === p], ["at 400 + " + p, i => i === 400 + p], ["at 30 and " + (31 + p), i => i === 30 || i === 31 + p]);
for (const [p, q] of [[0, 3], [7, 10], [62, 66], [300, 340]]) marks.push([p + " to " + q, i => i >= p && i < q]);
for (const p of [2, 3, 9, 13, 14, 31, 64]) marks.push(["every " + p, i => i % p === p - 1]);
for (const n of [0, 1, 7, 8, 9, 64, 65, 1400]) for (const [name, marked] of marks) { const a = make(n, marked); const result = run(a, n); console.log(n, name, result, state()); }
