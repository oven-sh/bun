// Four functions call one another in tail position with one, nine, eighteen and two arguments, integers and fractions mixed. In a round of its own each of them does the damage before it leaves. The last one returns to the holder.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let victim: Point | null = null;
let strikeIn = 0;
function strike(stage: number): void {
  if (stage === strikeIn && victim !== null) delete (victim as any).x;
}

function two(a: number, b: number): number {
  strike(4);
  return a * 2 + b;
}
function eighteen(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number): number {
  strike(3);
  return two(a + c + e + g + i + k + m + o + q, b + d + f + h + j + l + n + p + r);
}
function nine(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number): number {
  strike(2);
  return eighteen(a, b + 0.5, c, d + 0.5, e, f + 0.5, g, h + 0.5, i, a + 0.25, b, c + 0.25, d, e + 0.25, f, g + 0.25, h, i + 0.25);
}
function one(a: number): number {
  strike(1);
  return nine(a, a + 1, a + 2, a + 3, a + 4, a + 5, a + 6, a + 7, a + 8);
}

function holder(p: Point, n: number): string {
  const before = p.x;
  const got = one(n);
  return before + " " + got + " " + p.x + "," + p.y;
}

for (let round = 0; round < 500; round++) {
  strikeIn = round % 100 === 99 ? (round + 1) / 100 : 0;
  const p = new Point(round, 1);
  victim = p;
  const line = holder(p, round);
  if (strikeIn || round === 0) console.log(round + ": " + line);
}
