// Callees that return a fraction, a boolean, a string, undefined and nothing at all each damage the caller's object now and then. The result must arrive whichever way the call comes back.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let strikes = false;
function hit(p: Point): void {
  if (strikes) (p as any).extra = 1;
}
function fraction(p: Point, n: number): number {
  hit(p);
  return n / 4;
}
function truth(p: Point, n: number): boolean {
  hit(p);
  return n % 3 === 0;
}
function text(p: Point, n: number): string {
  hit(p);
  return "t" + n;
}
function maybe(p: Point, n: number): number | undefined {
  hit(p);
  return n & 1 ? undefined : n;
}
function nothing(p: Point): void {
  hit(p);
}

function holder(n: number): string {
  const a = new Point(n, 1), b = new Point(n, 2), c = new Point(n, 3), d = new Point(n, 4), e = new Point(n, 5);
  const first = fraction(a, n);
  const second = truth(b, n);
  const third = text(c, n);
  const fourth = maybe(d, n);
  const fifth = nothing(e);
  const sum = a.x + b.y + c.x + d.y + e.x;
  return [first, second, third, fourth, fifth].join(" ") + " " + sum + " " + [a, b, c, d, e].map(p => Object.keys(p).length).join("");
}

for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const line = holder(round);
  if (strikes || round % 100 === 98) console.log(round + ": " + line);
}
