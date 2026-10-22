// One call of the holder, and below it the callee damages one object after the other, ten of them, with typed work in between. Each write finds the same callers on the stack, whose return addresses are swapped already.
// The holder has all ten in local variables and reads them behind the call. Then it goes on in a loop, with whole objects again, in the same activation.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let strikes = false;
function spoil(list: Point[]): number {
  let sum = 0;
  for (let index = 0; index < list.length; index++) {
    const p = list[index];
    sum += p.x + p.y;
    if (strikes) {
      if (index % 3 === 0) delete (p as any).x;
      else if (index % 3 === 1) (p as any).y = "T";
      else Object.setPrototypeOf(p, { z: index });
    }
  }
  return sum;
}

function holder(round: number): string {
  let text = "";
  for (let turn = 0; turn < 3; turn++) {
    const a = new Point(round, 0), b = new Point(round, 1), c = new Point(round, 2), d = new Point(round, 3), e = new Point(round, 4);
    const f = new Point(round, 5), g = new Point(round, 6), h = new Point(round, 7), i = new Point(round, 8), j = new Point(round, 9);
    const before = a.x + b.x + c.x + d.x + e.x + f.y + g.y + h.y + i.y + j.y;
    strikes = round % 100 === 99 && turn === 1;
    const got = spoil([a, b, c, d, e, f, g, h, i, j]);
    text += before + " " + got + " " + a.x + b.y + (c as any).z + d.x + e.y + (f as any).z + g.x + h.y + (i as any).z + j.x + (c instanceof Point) + (d instanceof Point) + " | ";
  }
  return text;
}

for (let round = 0; round < 300; round++) {
  const line = holder(round);
  if (round % 100 === 99 || round === 0) console.log(round + ": " + line);
}
