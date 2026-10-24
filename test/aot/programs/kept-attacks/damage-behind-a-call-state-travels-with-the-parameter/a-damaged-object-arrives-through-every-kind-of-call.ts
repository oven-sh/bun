// A typed function reads the fields of its parameter. Whole and damaged objects reach it by a plain call, by call, apply and bind, as a callback of built-ins, through a spread, as a method, as a getter's `this`, and through `new`.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  sum(): string {
    return "" + (this.x + this.y);
  }
  get total(): string {
    return "" + (this.x + this.y);
  }
}
function sum(p: Point): string {
  return "" + (p.x + p.y);
}
class Holder {
  told: string;
  constructor(p: Point) {
    this.told = "" + (p.x + p.y);
  }
}

const ways: [string, (p: Point) => string][] = [
  ["plain", p => sum(p)],
  ["call", p => sum.call(undefined, p)],
  ["apply", p => sum.apply(undefined, [p])],
  ["bind", p => sum.bind(undefined, p)()],
  ["reflect", p => Reflect.apply(sum, undefined, [p])],
  ["map", p => [p].map(sum)[0]],
  ["spread", p => sum(...([p] as [Point]))],
  ["method", p => p.sum()],
  ["borrowed", p => Point.prototype.sum.call(p)],
  ["getter", p => p.total],
  ["new", p => new Holder(p).told],
];

function make(kind: number, n: number): Point {
  const p = new Point(n, 1);
  if (kind === 1) delete (p as any).x;
  else if (kind === 2) (p as any).y = "T";
  else if (kind === 3) Object.defineProperty(p, "x", { get: () => -7 });
  return p;
}

for (const [name, way] of ways) {
  let text = "";
  for (let round = 0; round < 200; round++) {
    const kind = round % 50 === 49 ? (round + 1) / 50 : 0;
    const told = way(make(kind, round));
    if (kind) text += " " + told;
  }
  console.log(name + ":" + text);
}
