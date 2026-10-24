// The caller holds objects, arrays and strings that nothing else refers to. The callee does the damage, so its return address is no longer that of the call site, and then collects and fills the heap again. The collector has to find what the caller holds.
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
function churn(): void {
  Bun.gc(true);
  for (let index = 0; index < 2000; index++) {
    const filler = new Point(-1, -2);
    const list = [-3, -4, -5];
    sink += filler.x + list[2] + ("f" + index).length;
  }
  Bun.gc(true);
}
function damages(p: Point): number {
  if (!strikes) return 0;
  delete (p as any).x;
  churn();
  return 1;
}

function holder(n: number): string {
  const p = new Point(n, 1);
  const a = new Point(n + 1, 2);
  const b = new Point(n + 2, 3);
  const list = [n, n + 1, n + 2];
  const halves = [n + 0.5, n + 1.5];
  const name = "n" + n + "!";
  const nested = { inner: new Point(n + 3, 4), items: [new Point(n + 4, 5)] };
  const got = damages(p);
  return [got, p.x, p.y, a.x, a.y, b.x, b.y, list[0], list[2], halves[1], name, nested.inner.x, nested.items[0].y].join(" ");
}

for (let round = 0; round < 60; round++) {
  strikes = round % 20 === 19;
  const line = holder(round);
  if (strikes || round === 0) console.log(round + ": " + line);
}
