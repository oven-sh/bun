// The callee declares that it returns a number. In some rounds it returns a string, in some it damages the caller's object, in some both, so the second return point is reached for either reason and for both at once.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let misfit = false;
let strikes = false;
const odd: any = "odd";
function measure(p: Point, n: number): number {
  if (strikes) delete (p as any).y;
  if (misfit) return odd;
  return n * 2;
}

function holder(p: Point, n: number): string {
  const before = p.x + p.y;
  const got = measure(p, n);
  return before + " " + (got + 1) + " " + typeof got + " " + (p.x + p.y);
}

for (let round = 0; round < 400; round++) {
  misfit = round % 100 === 97 || round % 100 === 99;
  strikes = round % 100 === 98 || round % 100 === 99;
  const line = holder(new Point(round, 1), round);
  if (round % 100 >= 96) console.log(round + ": " + line);
}
