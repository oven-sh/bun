// An async function reads an object, awaits a call of another async function, and reads the object again. The damage is done behind the first await of the callee, so in another turn of the event loop.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let strikes = false;
async function works(p: Point): Promise<number> {
  const before = p.y;
  await null;
  if (strikes) delete (p as any).x;
  return before + p.y;
}

async function holder(p: Point): Promise<string> {
  const before = p.x;
  const got = await works(p);
  return before + " " + got + " " + p.x + "," + p.y;
}

for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const line = await holder(new Point(round, 1));
  if (strikes || round === 0) console.log(round + ": " + line);
}

export {};
