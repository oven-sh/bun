// Three functions hold the object, each with a finally block that reads it. The innermost call does the damage and throws. Every finally block runs while the exception is on its way, and the outermost function catches.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let strikes = false;
let trail = "";
function innermost(p: Point): number {
  if (strikes) {
    (p as any).x = null;
    throw new Error("innermost");
  }
  return 1;
}
function inner(p: Point): number {
  const before = p.x;
  try {
    return innermost(p);
  } finally {
    trail += "inner " + before + ">" + p.x + ";";
  }
}
function middle(p: Point): number {
  const before = p.x;
  try {
    return inner(p) + 1;
  } finally {
    trail += "middle " + before + ">" + p.x + ";";
  }
}
function outermost(p: Point): string {
  const before = p.x;
  try {
    return "returned " + middle(p) + " " + p.x;
  } catch (error) {
    return "caught " + (error as Error).message + " " + before + ">" + p.x;
  }
}

for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  trail = "";
  const line = outermost(new Point(round, 1));
  if (strikes || round === 0) console.log(round + ": " + line + " | " + trail);
}
