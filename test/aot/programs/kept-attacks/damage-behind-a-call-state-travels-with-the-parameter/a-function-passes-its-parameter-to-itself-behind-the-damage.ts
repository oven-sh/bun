// A function reads its parameter, calls something that damages the object at one depth, and passes the parameter to itself. Every deeper call and every call on the way back reads the field in place.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let strikeAt = -1;
function touch(p: Point, depth: number): void {
  if (depth === strikeAt) delete (p as any).x;
}

function descend(p: Point, depth: number): string {
  const before = p.x;
  touch(p, depth);
  const behind = p.x;
  const below = depth === 0 ? "." : descend(p, depth - 1);
  return before + ">" + behind + " " + below + " " + p.x;
}

for (let round = 0; round < 300; round++) {
  strikeAt = round % 100 === 99 ? 2 : -1;
  const line = descend(new Point(round, 1), 4);
  if (strikeAt >= 0 || round === 0) console.log(round + ": " + line);
}
