// An async function does the damage and throws in front of its first await. Nothing is thrown to its caller: the call returns a rejected promise as usual. The caller, which is no async function, reads its object behind the call.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let strikes = false;
async function fails(p: Point): Promise<number> {
  if (strikes) {
    delete (p as any).x;
    throw new Error("rejected");
  }
  return 1;
}

const outcomes: Promise<string>[] = [];
function holder(p: Point): string {
  const before = p.x;
  const promise = fails(p);
  const after = p.x;
  outcomes.push(promise.then(value => "fulfilled " + value, error => (error as Error).message));
  return before + " " + after + " " + p.y;
}

for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const line = holder(new Point(round, 1));
  if (strikes || round === 0) console.log(round + ": " + line);
}
console.log((await Promise.all(outcomes)).filter(outcome => outcome === "rejected").length);

export {};
