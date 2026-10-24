// A `for await` loop reads an object in every iteration. The async generator that feeds it does the damage between two of its yields, once in front of an await of its own and once behind it.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let strikes = false;
async function* feed(p: Point): AsyncGenerator<number> {
  yield 1;
  if (strikes) delete (p as any).x;
  yield 2;
  await null;
  if (strikes) (p as any).y = "text";
  yield 3;
}

async function holder(p: Point): Promise<string> {
  let text = p.x + "," + p.y;
  for await (const step of feed(p)) text += " " + step + ":" + p.x + "," + p.y;
  return text;
}

for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const line = await holder(new Point(round, 1));
  if (strikes || round === 0) console.log(round + ": " + line);
}

export {};
