// A typed function drives a generator by hand with next, throw and return. The generator does the damage in the handler that `throw` enters and in the finally block that `return` enters.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let strikes = false;
function* listens(p: Point, q: Point): Generator<number, number, number> {
  try {
    let sent = 0;
    try {
      sent = yield 1;
    } catch {
      if (strikes) delete (p as any).x;
      sent = yield 2;
    }
    return sent;
  } finally {
    if (strikes) (q as any).x = "text";
  }
}

function holder(p: Point, q: Point): string {
  const before = p.x + q.x;
  const generator = listens(p, q);
  const first = generator.next().value;
  const second = generator.throw(new Error("in")).value;
  const between = p.x + "," + q.x;
  const third = generator.return(9).value;
  return before + " " + first + second + third + " " + between + " " + p.x + "," + q.x;
}

for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const line = holder(new Point(round, 1), new Point(round, 2));
  if (strikes || round === 0) console.log(round + ": " + line);
}
