// A loop in a typed function steps a generator that delegates to another one with `yield*`. The inner one does the damage. The loop reads its object in every iteration.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let strikes = false;
function* inner(p: Point): Generator<number> {
  yield 2;
  if (strikes) Object.defineProperty(p, "x", { get: () => -7 });
  yield 3;
}
function* outer(p: Point): Generator<number> {
  yield 1;
  yield* inner(p);
  yield 4;
}

function holder(p: Point): string {
  let text = "" + p.x;
  for (const step of outer(p)) text += " " + step + ":" + p.x;
  return text;
}

for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const line = holder(new Point(round, 1));
  if (strikes || round === 0) console.log(round + ": " + line);
}
