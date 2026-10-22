// A constructor passes `this` to a typed function before it has stored all the fields, and that function reads them in place and keeps the object for later.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number, early: boolean) {
    this.x = x;
    if (early) seen += look(this) + ";";
    this.y = y;
    seen += look(this) + ";";
  }
}

let seen = "";
let kept: Point | null = null;
function look(p: Point): string {
  kept = p;
  return p.x + "," + p.y + "," + (p.x + p.y);
}

for (let round = 0; round < 300; round++) {
  seen = "";
  const p = new Point(round, 1, round % 100 === 99);
  const line = seen + " " + p.x + "," + p.y + " " + (kept === p) + " " + look(kept!);
  if (round % 100 === 99 || round === 0) console.log(round + ": " + line);
}
