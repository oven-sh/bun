// One callee gathers its arguments in a rest parameter, another one reads the arguments object, a third one is called with fewer and with more arguments than it declares. Each does the damage now and then.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let strikes = false;
function withRest(p: Point, ...rest: number[]): number {
  if (strikes) delete (p as any).x;
  let sum = 0;
  for (const value of rest) sum += value;
  return sum;
}
function withArguments(p: Point, a: number, b: number): number {
  if (strikes) (p as any).y = "T";
  return arguments.length * 100 + a + b + (arguments[3] ?? 0);
}
function withDefaults(p: Point, a?: number, b: number = 7): number {
  if (strikes) Object.defineProperty(p, "x", { get: () => -7, configurable: true });
  return (a ?? 1) + b;
}

function holder(p: Point, q: Point, r: Point, n: number): string {
  const before = p.x + q.y + r.x;
  const first = withRest(p, n, n + 1, n + 2, n + 3, n + 4, n + 5, n + 6, n + 7);
  const afterFirst = p.x;
  const second = (withArguments as any)(q, 1, 2, 3, 4);
  const afterSecond = q.y;
  const third = withDefaults(r) + withDefaults(r, 2) + withDefaults(r, 2, 3);
  return before + " " + first + ":" + afterFirst + " " + second + ":" + afterSecond + " " + third + ":" + r.x;
}

for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const line = holder(new Point(round, 1), new Point(round, 2), new Point(round, 3), round);
  if (strikes || round === 0) console.log(round + ": " + line);
}
