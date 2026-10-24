// The callee takes an object literal as its only argument, so its fields may travel as arguments of their own and the object may never be made. One field is the object that the caller holds. On a rare path the callee damages it and keeps the literal.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

type Order = { target: Point; by: number; label: string };
let strikes = false;
let kept = null as Order | null;
function apply(order: Order): number {
  if (strikes) {
    delete (order.target as any).x;
    kept = order;
  }
  return order.by + order.label.length;
}

function holder(p: Point, n: number): string {
  const before = p.x;
  const got = apply({ target: p, by: n, label: "l" + n });
  return before + " " + got + " " + p.x + "," + p.y;
}

for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const line = holder(new Point(round, 1), round);
  if (strikes || round === 0) console.log(round + ": " + line + " " + (kept === null ? "-" : kept.by + kept.label + kept.target.y));
}
