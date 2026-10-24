// The callee does the damage in the middle of a computation, with small integers and fractions in local variables. What it computes behind the damage is built from them, and so is what it returns.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let strikes = false;
function compute(p: Point, n: number, f: number): number {
  const a = n + 1, b = n * 2, c = n - 3, d = n ^ 5, e = n << 2, g = n >> 1;
  const h = f * 1.5, i = f / 4, j = f - 0.25, k = f + n, l = f * f, m = f * 0.125;
  if (strikes) (p as any).x = "text";
  return a + b + c + d + e + g + h + i + j + k + l + m + p.y;
}

function holder(p: Point, n: number): string {
  const before = p.x;
  const got = compute(p, n, n + 0.5);
  return before + " " + got + " " + p.x;
}

for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const line = holder(new Point(round, 1), round);
  if (strikes || round % 100 === 98) console.log(round + ": " + line);
}
