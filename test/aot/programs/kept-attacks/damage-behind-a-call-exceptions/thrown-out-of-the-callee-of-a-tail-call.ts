// The callee does the damage and leaves through a call in tail position. The function that runs in its place throws. The handler is the holder's, whose call site the exception has to be matched to.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let strikes = false;
function last(n: number): number {
  if (strikes) throw new Error("from the last");
  return n;
}
function callee(p: Point): number {
  if (strikes) delete (p as any).x;
  return last(p.y);
}

function holder(p: Point): string {
  const before = p.x;
  let first = "";
  try {
    first = "" + callee(p);
  } catch (error) {
    first = (error as Error).message;
  }
  let second = "";
  try {
    second = "" + callee(p);
  } catch (error) {
    second = "again " + (error as Error).message;
  }
  return before + " " + first + " " + second + " " + p.x;
}

for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const line = holder(new Point(round, 1));
  if (strikes || round === 0) console.log(round + ": " + line);
}
