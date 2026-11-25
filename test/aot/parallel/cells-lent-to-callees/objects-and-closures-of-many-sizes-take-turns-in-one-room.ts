// In one stretch of a function without a branch, objects and closures of several sizes are lent in turn: a smaller one behind a larger, three alive at once as arguments of one another, and every callee collects and goes deep first.
const unseen = <T,>(x: T): T => [x][JSON.parse("0")];

function deep(n: number, a: number, b: number): number {
  const x = [a, b, n];
  return n ? deep(n - 1, b + 1, a + 2) + x[n % 3] : x[0];
}

function look(o: any, more: number): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  deep(40, 1, 2);
  Bun.gc(true);
  return o.a + (o.h ?? 0) + o.t.length + more + work;
}

function twice(run: () => number): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  deep(40, 3, 4);
  Bun.gc(true);
  return run() + run() + work;
}

function mixes(x: any, s: any, u: any): string {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const r1 = look({ a: x, b: s, c: u, d: s, e: u, f: s, g: u, h: x + 7, t: s + u }, 0);
  const r2 = twice(() => x + s.length);
  const r3 = look({ a: x, t: u + s }, 0);
  const r4 = twice(() => x + s.length + u.length + r1 + r2 + r3);
  const r5 = look({ a: r4, b: u, c: s, h: 1, t: u }, look({ a: x, t: s }, twice(() => r4 + u.length)));
  return [r1, r2, r3, r4, r5, work].join(" ");
}

let line = "";
for (let round = 0; round < 30; round++) line = mixes(unseen(1), unseen("ab"), unseen("cde"));
console.log(line);
