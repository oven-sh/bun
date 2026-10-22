// A frame between the damage and the holder catches the exception, reads the object, and throws it again. The holder catches that. Each of the two reads in its own catch block.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let strikes = false;
let noted = "";
function deep(p: Point): number {
  if (strikes) {
    (p as any).x = "text";
    throw new Error("deep");
  }
  return 1;
}
function middle(p: Point): number {
  const before = p.x;
  try {
    return deep(p) + before;
  } catch (error) {
    noted = before + ">" + p.x;
    throw error;
  }
}

function holder(p: Point): string {
  const before = p.x;
  try {
    return before + " " + middle(p) + " " + p.x;
  } catch (error) {
    return before + " " + (error as Error).message + " " + p.x + " " + noted;
  }
}

for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const line = holder(new Point(round, 1));
  if (strikes || round === 0) console.log(round + ": " + line);
}
