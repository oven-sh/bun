// A function ends in `return inner(p, () => ..)`. The closure and its variables are made for the call, so they may lie in the frame, and then the frame cannot be given up. The damage that `inner` does has to reach the holder all the same.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let strikes = false;
function inner(p: Point, weigh: (y: number) => number): number {
  if (strikes) (p as any).x = "T";
  return weigh(p.y);
}
function leaves(p: Point, n: number): number {
  const factor = n + 1;
  return inner(p, y => y * factor);
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
