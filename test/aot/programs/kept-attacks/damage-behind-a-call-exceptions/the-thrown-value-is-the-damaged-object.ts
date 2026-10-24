// The callee damages the object and throws that very object. The holder reads it through its parameter and through the binding of the catch clause.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let strikes = false;
function check(p: Point): number {
  if (strikes) {
    delete (p as any).y;
    throw p;
  }
  return p.y;
}

function holder(p: Point): string {
  const before = p.x + p.y;
  try {
    return before + " " + check(p) + " " + (p.x + p.y);
  } catch (thrown) {
    const q = thrown as Point;
    return before + " thrown " + q.x + "," + q.y + " " + p.x + "," + p.y + " " + (p === q);
  }
}

for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const line = holder(new Point(round, 1));
  if (strikes || round === 0) console.log(round + ": " + line);
}
