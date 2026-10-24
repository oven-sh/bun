// The caller holds small integers, fractions, booleans, strings and objects in local variables across a call that comes back by the second return point. All of them must be what they were.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let strikes = false;
function touch(p: Point): number {
  if (strikes) delete (p as any).x;
  return 1;
}

function holder(p: Point, n: number, f: number, flag: boolean, name: string): string {
  const a = n + 1, b = n * 2, c = n - 3, d = n ^ 5, e = n << 2, g = n >> 1;
  const h = f * 1.5, i = f / 3, j = f - 0.25, k = f + n, l = Math.sqrt(f), m = f * f;
  const o = !flag, q = flag && n > 10, r = name + "!", s = name.length;
  const t = p.x, u = p.y;
  const got = touch(p);
  return [a, b, c, d, e, g, h, i, j, k, l, m, o, q, r, s, t, u, got, p.x, p.y, n, f, flag, name].join(" ");
}

for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const line = holder(new Point(round, 1), round, round + 0.5, (round & 1) === 0, "n" + round);
  if (strikes || round === 0) console.log(round + ": " + line);
}
