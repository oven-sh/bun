// The callee of an awaited call damages one object in front of its first await and another one behind it. The caller holds both, and reads both between the call and the await of its promise, and behind the await.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let strikes = false;
async function works(early: Point, late: Point): Promise<number> {
  if (strikes) delete (early as any).x;
  await null;
  if (strikes) (late as any).x = "text";
  return 1;
}

async function holder(early: Point, late: Point): Promise<string> {
  const before = early.x + late.x;
  const promise = works(early, late);
  const between = early.x + "," + late.x;
  const got = await promise;
  return before + " " + between + " " + got + " " + early.x + "," + late.x;
}

for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const line = await holder(new Point(round, 1), new Point(round, 2));
  if (strikes || round === 0) console.log(round + ": " + line);
}

export {};
