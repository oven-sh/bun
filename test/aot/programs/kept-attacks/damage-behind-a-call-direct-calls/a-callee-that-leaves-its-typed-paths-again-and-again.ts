// One activation of the callee does damage five times over, to five objects, with typed work in between. It has one return address to swap, and swapping it again changes nothing.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let strikes = false;
function spoil(list: Point[]): number {
  let sum = 0;
  for (let index = 0; index < list.length; index++) {
    const p = list[index];
    sum += p.x + p.y;
    if (strikes) {
      if (index & 1) delete (p as any).x;
      else (p as any).y = "T";
    }
    sum += index;
  }
  return sum;
}

function holder(a: Point, b: Point, c: Point, d: Point, e: Point): string {
  const before = a.x + b.x + c.x + d.x + e.x;
  const got = spoil([a, b, c, d, e]);
  return before + " " + got + " " + [a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y, e.x, e.y].join();
}

for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const line = holder(new Point(round, 1), new Point(round, 2), new Point(round, 3), new Point(round, 4), new Point(round, 5));
  if (strikes || round === 0) console.log(round + ": " + line);
}
