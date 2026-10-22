// A function ends in `return inner(p, { .. })`. The object is made for the call, so it may lie in the frame, and then the frame cannot be given up. Whether it jumps or calls and returns, the damage that `inner` does has to reach the holder.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let strikes = false;
function inner(p: Point, options: { scale: number; shift: number }): number {
  if (strikes) delete (p as any).x;
  return p.y * options.scale + options.shift;
}
function leaves(p: Point, n: number): number {
  return inner(p, { scale: n, shift: 1 });
}

function holder(p: Point, n: number): string {
  const before = p.x;
  const got = leaves(p, n);
  return before + " " + got + " " + p.x + "," + p.y;
}

for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const line = holder(new Point(round, 2), round);
  if (strikes || round === 0) console.log(round + ": " + line);
}
