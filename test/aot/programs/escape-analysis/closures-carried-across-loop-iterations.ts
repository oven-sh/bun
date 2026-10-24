// Closures that are created in loops and carried over to the next iteration or kept in an array.
const kept: (() => number)[] = [];
function carried(n: number): number {
  let previous: (() => number) | undefined;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const weight = i * 10 + n;
    const f = (): number => weight + sum % 7;
    if (previous) sum += previous();
    previous = f;
  }
  return sum + (previous ? previous() : 0);
}
function carriedTwoTurns(n: number): number {
  let last: (() => number) | undefined;
  let beforeLast: (() => number) | undefined;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const weight = i * 3 + 1;
    const f = (): number => weight;
    if (beforeLast) sum += beforeLast() * 100 + (last ? last() : 0);
    beforeLast = last;
    last = f;
  }
  return sum;
}
function calledAheadOfItsNextBirth(n: number): number {
  let previous: (() => number) | undefined;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    let weight = i * 10 + n;
    if (previous) sum += previous() * (i + 1);
    const f = (): number => ++weight;
    weight += 2;
    previous = f;
  }
  return sum + (previous ? previous() : 0);
}
function keptLater(flag: boolean, n: number): number {
  let t = n;
  const a = (): number => ++t;
  const b = (): number => t + 100;
  const f = flag ? a : b;
  kept.push(f);
  return f();
}
function returnedLater(flag: boolean, n: number): () => number {
  let t = n;
  let h = n * 31 + 7;
  h = ((h ^ (h >> 1)) + 17) % 100003; if (h % 1009 === 0) kept.length = 0;
  h = ((h ^ (h >> 2)) + 20) % 100003; if (h % 1011 === 0) kept.length = 0;
  h = ((h ^ (h >> 3)) + 23) % 100003; if (h % 1013 === 0) kept.length = 0;
  h = ((h ^ (h >> 4)) + 26) % 100003; if (h % 1015 === 0) kept.length = 0;
  h = ((h ^ (h >> 5)) + 29) % 100003; if (h % 1017 === 0) kept.length = 0;
  h = ((h ^ (h >> 1)) + 32) % 100003; if (h % 1019 === 0) kept.length = 0;
  h = ((h ^ (h >> 2)) + 35) % 100003; if (h % 1021 === 0) kept.length = 0;
  h = ((h ^ (h >> 3)) + 38) % 100003; if (h % 1023 === 0) kept.length = 0;
  h = ((h ^ (h >> 4)) + 41) % 100003; if (h % 1025 === 0) kept.length = 0;
  h = ((h ^ (h >> 5)) + 44) % 100003; if (h % 1027 === 0) kept.length = 0;
  h = ((h ^ (h >> 1)) + 47) % 100003; if (h % 1029 === 0) kept.length = 0;
  h = ((h ^ (h >> 2)) + 50) % 100003; if (h % 1031 === 0) kept.length = 0;
  h = ((h ^ (h >> 3)) + 53) % 100003; if (h % 1033 === 0) kept.length = 0;
  h = ((h ^ (h >> 4)) + 56) % 100003; if (h % 1035 === 0) kept.length = 0;
  const a = (): number => ++t;
  const b = (): number => t + 100;
  const f = flag ? a : b;
  f();
  return f;
}
function same(a: unknown, b: unknown): boolean { if (kept.length > 1e9) return same(b, a); return a === b; }
function identity(n: number): boolean {
  function g(): number { return n; }
  const a = g;
  const b = g;
  return same(a, b) && a() === n;
}
function calls(f: (...list: number[]) => number): number { if (kept.length > 1e9) return calls(f); return f(1, 2, 3) + f(); }
function readsArguments(n: number): number {
  const f = function (): number { return arguments.length * 10 + n; };
  return calls(f) + calls(f);
}
let out = "";
for (let i = 0; i < 90; i++) {
  const a = carried(i % 6 + 2) * 1000 + calledAheadOfItsNextBirth(i % 4 + 3), b = carriedTwoTurns(i % 7 + 3), c = keptLater(i % 2 === 0, i), d = returnedLater(i % 3 === 0, i)() + returnedLater(i % 3 === 1, i + 1)() + returnedLater(true, i)() + returnedLater(false, 2)(), e = identity(i), g = readsArguments(i);
  if (i % 15 === 0) out += a + "|" + b + "|" + c + "|" + d + "|" + e + "|" + g + "\n";
}
let later = 0;
for (let i = 0; i < kept.length; i++) later += kept[i]();
console.log(out + later);
