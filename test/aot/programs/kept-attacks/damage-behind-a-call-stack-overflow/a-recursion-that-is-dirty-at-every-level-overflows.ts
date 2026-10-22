// A function damages an object of its own and calls itself, without end. The RangeError is caught by the function that started it, which holds an object and reads it in the handler and behind it.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let entered = 0;
function endless(p: Point, n: number): number {
  entered++;
  const mine = new Point(n, 1);
  delete (mine as any).x;
  if (n === 50) delete (p as any).x;
  return endless(p, n + 1) + mine.y;
}

function holder(p: Point): string {
  const before = p.x;
  let got: string;
  try {
    got = "returned " + endless(p, 0);
  } catch (error) {
    got = (error as Error).name + " " + p.x;
  }
  return before + " " + got + " " + p.x + "," + p.y;
}

for (let round = 0; round < 3; round++) {
  entered = 0;
  console.log(round + ": " + holder(new Point(round, 1)) + " went deep: " + (entered > 1000));
}
