// The damage is done, the heap is collected, and an exception is thrown through two frames. A finally block on the way collects again. The handler's function reads what it has held all the time.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let strikes = false;
function deep(p: Point): number {
  if (!strikes) return 1;
  (p as any).y = "text";
  Bun.gc(true);
  throw new Error("deep");
}
function middle(p: Point): number {
  const mine = new Point(5, 6);
  try {
    return deep(p) + mine.x;
  } finally {
    if (strikes) Bun.gc(true);
    seen = mine.x + "," + mine.y;
  }
}
let seen = "";

function holder(n: number): string {
  const p = new Point(n, 1);
  const kept = [new Point(n + 1, 2), new Point(n + 2, 3)];
  let got: string;
  try {
    got = "" + middle(p);
  } catch (error) {
    got = (error as Error).message;
  }
  return got + " " + p.x + "," + p.y + " " + kept[0].x + "," + kept[1].y + " " + seen;
}

for (let round = 0; round < 60; round++) {
  strikes = round % 20 === 19;
  const line = holder(round);
  if (strikes || round === 0) console.log(round + ": " + line);
}
