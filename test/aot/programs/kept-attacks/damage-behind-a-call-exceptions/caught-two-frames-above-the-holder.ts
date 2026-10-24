// The damage is done, then an exception is thrown. The function that holds the object has no handler, and neither has its caller. The function above them catches, reads the object in place and returns as usual to a caller that holds the object too.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let strikes = false;
function damageAndThrow(p: Point): number {
  if (!strikes) return 1;
  delete (p as any).x;
  throw new Error("behind the damage");
}

function holder(p: Point): number {
  const before = p.x;
  const got = damageAndThrow(p);
  return before + got + p.x;
}

function between(p: Point): number {
  return holder(p) + p.y;
}

function catcher(p: Point): string {
  const before = p.x + p.y;
  let got: string;
  try {
    got = "returned " + between(p);
  } catch (error) {
    got = "caught " + (error as Error).message;
  }
  return before + " " + got + " " + p.x + "," + p.y;
}

function outermost(p: Point): string {
  const before = p.x + p.y;
  const told = catcher(p);
  return before + " [" + told + "] " + p.x + "," + p.y + "," + (p.x + p.y);
}

for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const line = outermost(new Point(round, 1));
  if (strikes || round === 0) console.log(round + ": " + line);
}
