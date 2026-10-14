// A recursive function returns a pair both before and after its calls; the pair's allocation can be removed on both paths.
declare const console: { log(...v: unknown[]): void };
function big(x: number): number { return x < 2 ? x + 1 : big(x - 1) + big(x - 2) * 0.5; }
function pair(x: number): [number, number] {
  if (x < 0) return [x, -x]; //! removed
  let a = big(x & 7), b = big((x + 1) & 7); for (let i = 0; i < 2; i++) { a += big(a & 7); b += big(b & 7); if (a > 1e12) a = 1; if (b > 1e12) b = 2; }
  if (a > b) return [b, a]; //! removed
  return [a, b]; //! removed
}
function step(x: number, limit: number): { value: number, done: boolean } {
  if (x >= limit) return { value: -1, done: true }; //! removed
  let a = big(x & 7); for (let i = 0; i < 2; i++) { a += big(a & 7); if (a > 1e12) a = 1; }
  return { value: a, done: false }; //! removed
}
function named(x: number): { name: string, size: number, odd: boolean } {
  if (x === 0) return { name: "zero", size: 0, odd: false }; //! removed
  let a = big(x & 7); for (let i = 0; i < 2; i++) { a += big(a & 7); if (a > 1e12) a = 1; }
  return { name: a > 500 ? "large" : "small", size: a, odd: (a & 1) === 1 }; //! removed
}
let t = 0, turns = 0, names = "";
for (let i = -5; i < 40; i++) { const [p, q] = pair(i); t += q - p; }
for (let i = -3; i < 3; i++) { const [p, q] = pair(i * 7); t += q * 2 + p; }
for (let i = -3; i < 3; i++) { const [p] = pair(i * 11); t += p; }
for (let i = -3; i < 3; i++) { const [, q] = pair(i * 13); t -= q; }
for (let i = 0; ; i++) { const { value, done } = step(i, 25); if (done) break; t += value; turns++; }
for (let i = 0; ; i++) { const { value, done } = step(i, 7); if (done) { t += value; break; } turns++; }
for (let i = 0; ; i += 2) { const r = step(i, 9); if (r.done) break; t += r.value; turns++; }
for (let i = 3; ; i += 3) { const { done } = step(i, 30); if (done) break; turns++; }
for (let i = 0; i < 6; i++) { const { name, size, odd } = named(i); names += name[0]; t += size; if (odd) turns++; }
for (let i = 0; i < 6; i++) { const { name } = named(i * 3); names += name.length; }
for (let i = 0; i < 6; i++) { const { size } = named(i * 5); t += size; }
for (let i = 0; i < 6; i++) { const { odd, name } = named(i * 7); if (odd) names += name[1]; }
console.log(t, turns, names);
