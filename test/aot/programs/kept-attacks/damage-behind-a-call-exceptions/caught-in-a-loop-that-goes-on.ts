// A loop holds one object over all its iterations. In each iteration it makes a call under a handler. One call does the damage and throws, and the loop goes on reading the object.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let strikes = false;
function step(p: Point, index: number): number {
  if (strikes && index === 2) {
    delete (p as any).x;
    throw new Error("at " + index);
  }
  return index;
}

function holder(p: Point): string {
  let text = "";
  for (let index = 0; index < 5; index++) {
    try {
      text += p.x + ":" + step(p, index) + ":" + p.x + " ";
    } catch (error) {
      text += "(" + (error as Error).message + ":" + p.x + ") ";
    }
  }
  return text;
}

for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const line = holder(new Point(round, 1));
  if (strikes || round === 0) console.log(round + ": " + line);
}
