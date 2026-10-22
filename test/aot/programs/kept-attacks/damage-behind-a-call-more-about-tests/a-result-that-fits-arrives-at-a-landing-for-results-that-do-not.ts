// `user` holds nothing across its call of `pick`: it only takes the result, which is declared a Point, and reads two fields of it. Such a call site has a second return point for a result that is no Point.
// In some rounds `pick` damages an object that `user` has never seen, so every return address on the stack that has a second return point is sent there, that of `pick` too: a Point arrives where strings are expected.
// In some rounds the result is a string, and in some both happen.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

const odd: any = "odd";
const points: Point[] = [];
for (let index = 0; index < 8; index++) points.push(new Point(index, index * 2));

let bystander: Point | null = null;
let misfit = false;

// It calls itself, so it stays a call.
function pick(n: number, depth: number): Point {
  if (depth > 0) return pick(n + 1, depth - 1);
  const target = bystander;
  if (target !== null) {
    bystander = null;
    (target as any).y = "gone";
  }
  return misfit ? odd : points[n & 7];
}

function user(n: number): string {
  const got = pick(n, 2);
  return typeof got + ":" + got.x + "," + got.y;
}

function holder(p: Point, n: number): string {
  const before = p.x + p.y;
  const told = user(n);
  return before + " " + told + " " + (p.x + p.y);
}

for (let round = 0; round < 400; round++) {
  const p = new Point(round, 1);
  misfit = round % 100 === 97 || round % 100 === 99;
  bystander = round % 100 >= 98 ? p : null;
  const line = holder(p, round);
  if (round % 100 >= 96 || round === 0) console.log(round + ": " + line);
}
