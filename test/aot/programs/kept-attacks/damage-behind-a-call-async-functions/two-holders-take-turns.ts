// Two activations of one async function hold the same object and take turns at their awaits. One of them makes the call that does the damage. The other one finds the object changed when it goes on.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

function touch(p: Point, strikes: boolean): number {
  if (strikes) delete (p as any).x;
  return 1;
}

async function holder(p: Point, strikes: boolean): Promise<string> {
  let text = "" + p.x;
  await null;
  text += " " + p.x;
  touch(p, strikes);
  text += " " + p.x;
  await null;
  return text + " " + p.x;
}

for (let round = 0; round < 300; round++) {
  const p = new Point(round, 1);
  const strikes = round % 100 === 99;
  const [first, second] = await Promise.all([holder(p, false), holder(p, strikes)]);
  if (strikes || round === 0) console.log(round + ": " + first + " | " + second);
}

export {};
