// The check of a captured value is no entry check any more: it stays in the typed body, so a caller that has proven its arguments enters the typed body with a capture that nobody has tested.
// Here the capture is a string, an object with valueOf, undefined, and a damaged object where a number or a Point is declared. The closure is called directly, by value, as a callback and by itself.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let log = "";
function makeAdder(step: number): (n: number) => number {
  return (n: number): number => n + step;
}

function makeReader(p: Point): (scale: number) => number {
  return (scale: number): number => p.x * scale + p.y;
}

function makeCounter(step: number): (n: number, depth: number) => number {
  const count = (n: number, depth: number): number => (depth === 0 ? n + step : count(n, depth - 1) + step);
  return count;
}

function callByValue(f: (n: number) => number, n: number): string {
  return "" + f(n);
}

function holder(step: number, p: Point, n: number): string {
  const add = makeAdder(step);
  const readPoint = makeReader(p);
  const count = makeCounter(step);
  const direct = add(n) + "," + add(n + 1);
  const mapped = [n, n + 1].map(add).join("/");
  return direct + " " + callByValue(add, n) + " " + mapped + " " + readPoint(2) + " " + callByValue(readPoint, 3) + " " + count(n, 2);
}

const steps: any[] = [
  1,
  "s",
  {
    valueOf() {
      log += "v";
      return 10;
    },
  },
  undefined,
  2.5,
];

for (let round = 0; round < 500; round++) {
  const kind = round % 100 === 99 ? (round + 1) / 100 : 0;
  const p = new Point(round, 1);
  if (kind === 1) (p as any).x = "text";
  else if (kind === 2) delete (p as any).y;
  else if (kind === 3) Object.defineProperty(p, "x", { get: () => 7, configurable: true });
  log = "";
  const line = holder(steps[kind % steps.length], kind === 4 ? ({ x: "other", y: 2 } as any) : p, round);
  if (kind !== 0 || round === 0) console.log(round + ": " + line + " " + log);
}
