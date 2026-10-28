// A function returns a small array or object and every caller only reads its elements, so the allocation can be removed.
declare const console: { log(...v: unknown[]): void };
function big(x: number): number { let s = 0; for (let i = 0; i < 3; i++) { s += (x + i) * (x - i); if (s > 1e9) s -= 1e9; } return s; }
function pair(x: number): [number, number] {
  let a = big(x), b = big(x + 1); for (let i = 0; i < 2; i++) { a += big(a & 7); b += big(b & 7); if (a > 1e12) a = 1; if (b > 1e12) b = 2; }
  if (a > b) return [b, a]; //! removed
  return [a, b]; //! removed
}
function triple(x: number): [number, string, boolean] {
  let a = big(x); for (let i = 0; i < 2; i++) { a += big(a & 7); if (a > 1e12) a = 1; }
  return [a, a > 100 ? "large" : "small", (a & 1) === 1]; //! removed
}
function record(x: number): { lo: number, hi: number, name: string } {
  let a = big(x), b = big(x + 1); for (let i = 0; i < 2; i++) { a += big(a & 7); b += big(b & 7); if (a > 1e12) a = 1; if (b > 1e12) b = 2; }
  if (a > b) return { lo: b, hi: a, name: "swapped" }; //! removed
  return { lo: a, hi: b, name: "kept" }; //! removed
}
function step(x: number): { value: number, done: boolean } {
  let a = big(x); for (let i = 0; i < 2; i++) { a += big(a & 7); if (a > 1e12) a = 1; }
  return { value: a, done: a > 5000 }; //! removed
}
let t = 0, names = 0, odd = 0;
for (let i = 0; i < 300; i++) { const [p, q] = pair(i); t += q - p; }
for (let i = 0; i < 300; i++) { const { lo, hi, name } = record(i); t += hi - lo; names += name.length; }
for (let i = 0; i < 300; i++) { const [n, s, o] = triple(i); t += n; names += s.length; if (o) odd++; }
for (let i = 0; i < 10; i++) { const [p, q] = pair(i * 3); t += q + p; const r = record(i * 5); t += r.hi; }
for (let i = 0; i < 10; i++) { const [p] = pair(i * 7); t += p; const { name } = record(i * 11); names += name.length; const [, s] = triple(i); names += s.length; }
// More than three calls of each in the text: "at most three calls" is a licence of the inliner.
for (let i = 0; i < 4; i++) { const [p, q] = pair(i + 40); t += q * p; const { hi } = record(i + 41); t += hi; const [n] = triple(i + 42); t -= n; const { value } = step(i & 1); t += value; }
for (let i = 0; i < 4; i++) { const [, q] = pair(i + 50); t += q; const { lo } = record(i + 51); t += lo; const [, , o] = triple(i + 52); if (o) odd++; const { done } = step(i & 1); if (done) odd++; }
for (let i = 0; i < 4; i++) { const { value, done } = step(i & 3); if (!done) t += value; const [p, q] = throwing(i + 30); t += p + q; const [a] = throwing(i + 31); t += a; }
let turns = 0; for (let i = 0; ; i++) { const { value, done } = step(i); if (done) break; t += value; turns++; }
// Under a handler, and a callee that throws between the two values.
function throwing(x: number): [number, number] { let a = big(x); for (let i = 0; i < 2; i++) { a += big(a & 7); if (a > 1e12) a = 1; } if (x === 7) throw new Error("between the two, at " + a); let b = big(x + 1); for (let i = 0; i < 2; i++) { b += big(b & 7); if (b > 1e12) b = 2; } return [a, b]; } //! removed
let caught = "";
for (let i = 0; i < 10; i++) { try { const [p, q] = throwing(i); t += p + q; } catch (e) { caught += (e as Error).message; } finally { turns++; } }
for (let i = 20; i < 25; i++) { const [p, q] = throwing(i); t += p - q; }
console.log(t, names, odd, turns, caught);
