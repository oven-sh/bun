// A function calls itself. Every activation holds an object of its own that nothing else refers to, damages another one, and goes deeper. At the bottom the heap is collected and filled again. On the way back each reads what it holds.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let strikes = false;
let sink = 0;
function tower(depth: number): string {
  const mine = new Point(depth, depth * 2);
  const list = [depth, depth + 1];
  const spoiled = new Point(depth, 0);
  if (strikes) (spoiled as any).x = "s" + depth;
  if (depth === 0) {
    Bun.gc(true);
    for (let index = 0; index < 3000; index++) sink += new Point(-1, -1).x + [-2, -2][1];
    Bun.gc(true);
    return "";
  }
  const below = tower(depth - 1);
  return mine.x + "," + mine.y + "," + list[1] + "," + spoiled.x + " " + below;
}

for (let round = 0; round < 40; round++) {
  strikes = round % 20 === 19;
  const line = tower(12);
  if (strikes || round === 0) console.log(round + ": " + line);
}
