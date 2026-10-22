// The damage is done three calls below the function that holds the object, and the exception that follows passes two frames that are dirty by then. The holder catches it and reads the object in the catch block and behind it.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let strikes = false;
function third(p: Point): number {
  if (strikes) {
    Object.defineProperty(p, "x", { get: () => -7 });
    throw new RangeError("from the third");
  }
  return 3;
}
function second(p: Point): number {
  const got = third(p);
  return got + p.y;
}
function first(p: Point): number {
  const got = second(p);
  return got + p.y;
}

function holder(p: Point): string {
  const before = p.x;
  let inside = "";
  try {
    inside = "returned " + first(p) + " " + p.x;
  } catch (error) {
    inside = "caught " + (error as Error).name + " " + p.x;
  }
  return before + " " + inside + " " + p.x + "," + p.y;
}

for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const line = holder(new Point(round, 1));
  if (strikes || round === 0) console.log(round + ": " + line);
}
