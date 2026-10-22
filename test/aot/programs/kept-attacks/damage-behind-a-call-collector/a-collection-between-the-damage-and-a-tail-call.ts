// The callee does the damage, collects, and leaves through a call in tail position with arguments that it has just allocated. The function that runs in its place collects once more and returns one of them to the holder.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let strikes = false;
function last(first: Point, second: Point, list: number[]): Point {
  if (strikes) Bun.gc(true);
  return list[0] & 1 ? first : second;
}
function leaves(p: Point, n: number): Point {
  if (strikes) {
    delete (p as any).x;
    Bun.gc(true);
  }
  return last(new Point(n, 10), new Point(n, 20), [n]);
}

function holder(n: number): string {
  const p = new Point(n, 1);
  const kept = new Point(n + 1, 2);
  const got = leaves(p, n);
  return got.x + "," + got.y + " " + p.x + "," + p.y + " " + kept.x + "," + kept.y;
}

for (let round = 0; round < 80; round++) {
  strikes = round % 20 >= 18;
  const line = holder(round);
  if (strikes || round === 0) console.log(round + ": " + line);
}
