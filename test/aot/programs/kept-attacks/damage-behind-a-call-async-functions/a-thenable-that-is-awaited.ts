// An async function awaits an object with a `then` method, which does the damage when the engine calls it. Another one awaits a promise whose reaction does it. Both read their object behind the await.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let strikes = false;
async function awaitsThenable(p: Point): Promise<string> {
  const before = p.x;
  const got = await {
    then(resolve: (value: number) => void) {
      if (strikes) delete (p as any).x;
      resolve(1);
    },
  };
  return before + " " + got + " " + p.x;
}
async function awaitsReaction(p: Point): Promise<string> {
  const before = p.y;
  const got = await Promise.resolve(2).then(value => {
    if (strikes) (p as any).y = "text";
    return value;
  });
  return before + " " + got + " " + p.y;
}

for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const p = new Point(round, 1);
  const line = (await awaitsThenable(p)) + " | " + (await awaitsReaction(p));
  if (strikes || round === 0) console.log(round + ": " + line);
}

export {};
