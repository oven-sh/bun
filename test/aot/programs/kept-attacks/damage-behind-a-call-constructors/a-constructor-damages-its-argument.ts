// The caller has read an object and passes it to `new`. The constructor damages it, in some rounds in front of its own stores to `this` and in some behind them.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let mode = 0;
class Wrapper {
  first: number;
  second: number;
  constructor(p: Point) {
    if (mode === 1) delete (p as any).x;
    this.first = p.y;
    if (mode === 2) (p as any).x = "text";
    this.second = p.y + 1;
  }
}

function holder(p: Point): string {
  const before = p.x;
  const wrapper = new Wrapper(p);
  return before + " " + wrapper.first + "," + wrapper.second + " " + p.x + "," + p.y;
}

for (let round = 0; round < 300; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  const line = holder(new Point(round, 1));
  if (mode || round === 0) console.log(round + ": " + line);
}
