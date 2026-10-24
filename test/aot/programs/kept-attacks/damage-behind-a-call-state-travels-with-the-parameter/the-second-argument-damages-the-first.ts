// The arguments of a call are evaluated from left to right. The first is an object that the caller has read. The evaluation of the second damages it, and then the typed body of the callee is entered.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let mode = 0;
function touch(p: Point): number {
  if (mode === 1) delete (p as any).x;
  else if (mode === 2) Object.defineProperty(p, "x", { get: () => -7 });
  else if (mode === 3) (p as any).x = "text";
  return mode;
}

function scaled(p: Point, by: number): string {
  return p.x + "," + p.y + "," + by;
}

function holder(p: Point): string {
  const before = p.x + p.y;
  return before + " " + scaled(p, touch(p)) + " " + p.x;
}

for (let round = 0; round < 400; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  const line = holder(new Point(round, 1));
  if (mode !== 0 || round % 100 === 0) console.log(round + ": " + line);
}
