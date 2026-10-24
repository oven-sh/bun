// The callee damages the object that it was handed and returns that very object. The caller reads it through the parameter and through the result.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let mode = 0;
function pass(p: Point): Point {
  if (mode === 1) delete (p as any).x;
  else if (mode === 2) (p as any).x = "text";
  else if (mode === 3) Object.setPrototypeOf(p, null);
  return p;
}

function holder(p: Point): string {
  const before = p.x + p.y;
  const q = pass(p);
  return before + " " + q.x + "," + q.y + " " + p.x + "," + p.y + " " + (p === q) + " " + (q instanceof Point);
}

for (let round = 0; round < 400; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  const line = holder(new Point(round, 1));
  if (mode || round === 0) console.log(round + ": " + line);
}
