// The first thing `nearest` does is to read a field of an object that a variable holds. Where that object is damaged the typed body begins again in its generic version, by a tail call,
// and the generic version returns for it. `nearest` ends in a tail call itself, so its generic version holds a required one and the restart is required too: no BecomeDirty stands in the restart block.
// In some rounds the generic version returns a string where the function declares a Point. The holder tests nothing at its plain return point and reads two raw fields of what it got.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

const odd: any = "odd";
let anchor: Point = new Point(5, 5);
let answer: Point = new Point(7, 8);

function same(p: Point): Point {
  return p;
}

function nearest(p: Point): Point {
  if (anchor.x > p.x) return same(answer);
  return p;
}

function holder(p: Point): string {
  const before = p.y;
  const got = nearest(p);
  return typeof got + " " + got.x + "," + got.y + " " + (before + p.y);
}

// One frame more: what arrives at the landing of `holder` makes `holder` return to the landing of this one.
function above(p: Point, q: Point): string {
  const before = q.x;
  const line = holder(p);
  return line + " " + (before + q.x);
}

for (let round = 0; round < 400; round++) {
  const damaged = round % 100 === 98 || round % 100 === 99;
  const misfit = round % 100 === 97 || round % 100 === 99;
  anchor = new Point(5, 5);
  if (damaged) delete (anchor as any).y;
  answer = misfit ? odd : new Point(7, 8);
  const near = above(new Point(round % 7, 1), new Point(2, 2));
  if (round % 100 >= 95) console.log(round + ": " + near);
}
