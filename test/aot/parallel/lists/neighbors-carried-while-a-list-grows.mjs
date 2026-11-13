// The element that an iteration has stored at the end of a list, which grows, comes round to the next one, which reads it.
// STATISTIC: ElementsCarriedAroundLoops >= 10
function schedule(key) { const c = key.length; const d = key.slice(0); let h = 1; for (let a = c; a < 4 * c + 28; a++) { let b = d[a - 1]; if (a % c === 0) { b = (b << 8) ^ (b >>> 24) ^ (h << 24); h = (h << 1) ^ ((h >> 7) * 283); } d[a] = d[a - c] ^ b; } return d; }
function sums(n) { const d = [1]; for (let i = 1; i < n; i++) { const b = d[i - 1]; d[i] = (b * 31 + i) | 0; } return d; }
function halves(n) { const d = [1.5]; for (let i = 1; i < n; i++) { const b = d[i - 1]; d[i] = b * 0.5 + i; } return d; }
function texts(n) { const d = ["a"]; for (let i = 1; i < n; i++) { const b = d[i - 1]; d[i] = b.length > 9 ? "b" : b + i; } return d; }
function mixed(n) { const d = [1]; for (let i = 1; i < n; i++) { const b = d[i - 1]; d[i] = i % 7 === 3 ? "t" + b : i % 5 ? b : -0; } return d; }
function twice(n) { const d = [1, 2]; for (let i = 2; i < n; i++) { const b = d[i - 1]; const a = d[i - 2]; d[i] = (a + b) & 0xfffff; } return d; }
function skips(n) { const d = [3]; for (let i = 1; i < n; i++) { const b = d[i - 1]; if (b === undefined) { d[i] = i; continue; } if (i % 11 === 7) i++; d[i] = b + 1; } return d; }
function rewrites(n) { const d = [3]; for (let i = 1; i < n; i++) { const b = d[i - 1]; d[i] = b + 1; if (i % 4 === 1) d[i] = -b; if (i % 6 === 1) d[i - 1] = 9; } return d; }
function shrinks(n) { const d = [3]; for (let i = 1; i < n; i++) { const b = d[i - 1]; d[i] = (b | 0) + 1; if (i % 9 === 5) d.length = i - 1; } return d; }
function pushes(n) { const d = [3]; for (let i = 1; i < n; i++) { const b = d[i - 1]; d.push(b ^ i); } return d; }
function stops(n) { const d = [3]; let i = 1; for (; i < n; i++) { const b = d[i - 1]; if (b > 900) break; d[i] = b + i; } return [d, i]; }
function behind(n) { const d = [3]; let last = 0; for (let i = 1; i < n; i++) { d[i] = last + i; last = d[i - 1]; } return [d, last]; }
function other(n) { const d = [3], e = [4]; for (let i = 1; i < n; i++) { const b = d[i - 1], c = e[i - 1]; d[i] = b + c; e[i] = (b ^ c) & 1023; } return [d, e]; }
function given(d, e, n) { for (let i = 1; i < n; i++) { const b = d[i - 1]; e[i] = b + 1; d[i] = b + e[i]; } return [d, e]; }
const alias = n => { const d = [2]; return given(d, d, n); };
const apart = n => given([2], [5], n);
const schedules = n => [4, 6, 8].map(c => schedule(Array.from({ length: c }, (_, i) => Math.imul(i + n, 2654435761))));
const show = value => Array.isArray(value) ? "[" + value.length + ":" + value.slice(0, 6).map(show) + "," + value.reduce((sum, x) => typeof x === "number" ? (sum * 31 + x * 4) | 0 : typeof x === "string" ? sum + x.length : sum + 1, 7) + "]" : Object.is(value, -0) ? "-0" : String(value);
let digest = 0, cases = 0;
for (const size of [0, 1, 2, 3, 4, 5, 17, 18, 60, 61, 700, 3000]) {
  for (const run of [schedules, sums, halves, texts, mixed, twice, skips, rewrites, shrinks, pushes, stops, behind, other, alias, apart]) {
    const line = show([run(size), run(size + 1)]);
    cases++;
    for (let i = 0; i < line.length; i++) digest = (digest * 31 + line.charCodeAt(i)) | 0;
    if (cases % 7 === 5) console.log(run.name, size, line.slice(0, 160));
  }
}
console.log(cases, digest);
