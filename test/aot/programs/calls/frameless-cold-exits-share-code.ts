// A function whose usual way makes no call has no frame. Each way out of it that makes calls is compiled apart. Where one way that only leads
// to a throw runs into the next, the code of the next is there once.
// CALLS+ clamped ^clamped: ([0-9][0-9]|1[0-7][0-9]) instructions;
declare const console: { log(...values: unknown[]): void };
declare const globalThis: { kept?: unknown };
const seen: string[] = [];
function report(what: string, value: number): number {
  let mixed = 0;
  for (let i = 0; i < 3; i++) { mixed += value + i; mixed ^= i; mixed += value * 2; mixed -= i; mixed |= 0; mixed += 7; mixed ^= value; mixed += 11; mixed -= 3; mixed += value & 5; mixed ^= 9; mixed += 13; mixed -= value >> 1; mixed |= 0 }
  seen.push(what + value + (mixed === 0.5 ? "!" : ""));
  if (seen.length > 6) seen.shift();
  return value < 0 ? 0 : 255;
}
function clamped(r: number, g: number, b: number, a: number): number {
  let first = 0;
  if (r >= 0) {
    if (g >= 0) {
      if (b >= 0) {
        if (a >= 0) return r + g * 2 + b * 3 + a * 5;
        first = 3;
      } else first = 2;
    } else first = 1;
  }
  let sum = 0;
  switch (first) {
    case 0: sum += report("r", r);
    case 1: sum += report("g", g) * 2;
    case 2: sum += report("b", b) * 3;
    case 3: sum += report("a", a) * 5;
  }
  throw new RangeError("out of range: " + sum);
}
function attempt(r: number, g: number, b: number, a: number): number | string { try { return clamped(r, g, b, a) } catch (e) { return (e as Error).message } }
globalThis.kept = clamped;
let total = 0;
for (let i = 0; i < 256; i++) {
  const part = (k: number) => (i >> (2 * k) & 3) === 0 ? -1 - k : 10 * k + (i & 7);
  const got = attempt(part(0), part(1), part(2), part(3)); total = (total + (typeof got === "number" ? got : got.length)) % 1000003;
}
console.log(total, seen.join());
console.log(attempt(1, 2, 3, 4), attempt(-1, 2, 3, 4), attempt(1, -2, 3, 4), attempt(1, 2, -3, 4), attempt(1, 2, 3, -4), attempt(-1, -2, -3, -4), seen.join());
