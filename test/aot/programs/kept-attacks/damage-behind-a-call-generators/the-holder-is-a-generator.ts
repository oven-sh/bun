// A generator holds an object across calls and across yields. One of the calls does the damage, and in another round its consumer does it between two steps.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let mode = 0;
function touch(p: Point): number {
  if (mode === 1) delete (p as any).x;
  return 1;
}

function* holder(p: Point): Generator<string> {
  const before = p.x;
  yield before + ":" + p.x;
  const got = touch(p);
  yield got + ":" + p.x;
  yield "last:" + p.x + "," + p.y;
}

function consume(p: Point): string {
  let text = "";
  let steps = 0;
  for (const told of holder(p)) {
    text += told + " ";
    if (++steps === 2 && mode === 2) (p as any).x = "text";
  }
  return text + p.x;
}

for (let round = 0; round < 300; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  const line = consume(new Point(round, 1));
  if (mode || round === 0) console.log(round + ": " + line);
}
