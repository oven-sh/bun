// The callee returns an object that it has just made, and the caller takes it apart at once, so the fields may travel in registers. In some rounds the callee has damaged the caller's object before it returns.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let strikes = false;
function split(p: Point, n: number): { low: number; high: number; half: number } {
  if (strikes) Object.defineProperty(p, "x", { get: () => -7 });
  return { low: n & 15, high: n >> 4, half: n / 2 };
}

function holder(p: Point, n: number): string {
  const before = p.x;
  const { low, high, half } = split(p, n);
  return before + " " + low + " " + high + " " + half + " " + p.x + " " + p.y;
}

for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const line = holder(new Point(round, 1), round);
  if (strikes || round % 100 === 98) console.log(round + ": " + line);
}
