// One of two stack-allocated closures is chosen by a condition and then called.
let noise = 0;
function calls(f: () => number): number { if (noise > 1e9) return calls(f); return f() + f(); }
function oneOfTwo(flag: boolean, n: number): number {
  let t = n;
  const a = (): number => ++t;
  const b = (): number => t + 100;
  const f = flag ? a : b;
  return calls(f) + calls(f) + t;
}
function orNone(flag: boolean, n: number): number {
  let t = n;
  const a = (): number => { t += 2; return t; };
  const f = flag ? a : undefined;
  let sum = 0;
  for (let i = 0; i < 3; i++) if (f) sum += f();
  return sum + t;
}
function throughALoop(n: number): number {
  let t = n;
  const step = (): number => { t += 3; return t; };
  let f = step;
  let sum = 0;
  for (let i = 0; i < 4; i++) { sum += f(); if (sum > 1e9) f = step; }
  return sum;
}
function apply2(f: (x: number) => number, x: number): number { if (noise > 1e9) return apply2(f, x); return f(x) + f(x + 1); }
function declared(n: number): number {
  let t = n;
  function add(x: number): number { t += x; return t; }
  return apply2(add, 1) + apply2(add, 2) + t;
}
function report(f: (text: string, ...rest: number[]) => number): number { if (noise > 1e9) return report(f); return f("a", 1, 2, 3) + f("bc") + f("d", 9, 8, 7, 6, 5, 4, 3, 2, 1, 0); }
function withRest(n: number): number {
  let t = n;
  const f = (text: string, ...rest: number[]): number => { t += text.length; for (const r of rest) t += r; return t + rest.length; };
  return report(f) + report(f);
}
function behindACut(n: number, depth: number): number {
  if (n < 0) return -1;
  if (depth < 100) {
  let t = n;
  let text = "s";
  let h = depth * 31 + 7;
  h = ((h ^ (h >> 1)) + 13) % 100003; if (h % 89 === 0) noise++;
  h = ((h ^ (h >> 2)) + 18) % 100003; if (h % 91 === 0) noise++;
  h = ((h ^ (h >> 3)) + 23) % 100003; if (h % 93 === 0) noise++;
  h = ((h ^ (h >> 4)) + 28) % 100003; if (h % 95 === 0) noise++;
  h = ((h ^ (h >> 5)) + 33) % 100003; if (h % 97 === 0) noise++;
  h = ((h ^ (h >> 1)) + 38) % 100003; if (h % 99 === 0) noise++;
  h = ((h ^ (h >> 2)) + 43) % 100003; if (h % 101 === 0) noise++;
  h = ((h ^ (h >> 3)) + 48) % 100003; if (h % 103 === 0) noise++;
  h = ((h ^ (h >> 4)) + 53) % 100003; if (h % 105 === 0) noise++;
  h = ((h ^ (h >> 5)) + 58) % 100003; if (h % 107 === 0) noise++;
  h = ((h ^ (h >> 1)) + 63) % 100003; if (h % 109 === 0) noise++;
  h = ((h ^ (h >> 2)) + 68) % 100003; if (h % 111 === 0) noise++;
  h = ((h ^ (h >> 3)) + 73) % 100003; if (h % 113 === 0) noise++;
  h = ((h ^ (h >> 4)) + 78) % 100003; if (h % 115 === 0) noise++;
  const add = (x: number): number => { t += x; text += x; return t + text.length; };
  if (depth > 0) return apply2(add, h % 5) + behindACut(n - 1, depth - 1);
  return apply2(add, 1) + apply2(add, 2) + t;
  }
  return 0;
}
let out = "";
for (let i = 0; i < 120; i++) {
  const a = oneOfTwo(i % 2 === 0, i), b = orNone(i % 3 !== 0, i), c = throughALoop(i), d = declared(i), e = withRest(i), g = behindACut(i, 2) + behindACut(-i, 1) + behindACut(i + 1, 0) + behindACut(3, 1);
  if (i % 24 === 0) out += a + "|" + b + "|" + c + "|" + d + "|" + e + "|" + g + "\n";
}
console.log(out);
