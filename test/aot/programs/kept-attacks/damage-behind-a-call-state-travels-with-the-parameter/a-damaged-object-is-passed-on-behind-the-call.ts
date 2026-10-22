// A typed caller has read an object, so it may enter the typed body of the next function without a test. Between the read and that call another call damages the object.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let mode = 0;
function touch(p: Point): number {
  if (mode === 1) delete (p as any).x;
  else if (mode === 2) Object.defineProperty(p, "x", { get: () => -7, configurable: true });
  else if (mode === 3) (p as any).x = "text";
  else if (mode === 4) {
    delete (p as any).x;
    Object.setPrototypeOf(p, { x: "inherited" });
  }
  return mode;
}

function sum(p: Point): string {
  return "" + (p.x + p.y);
}

function holder(p: Point): string {
  const before = p.x + p.y;
  const touched = touch(p);
  return before + " " + touched + " " + sum(p) + " " + sum(p);
}

for (let round = 0; round < 500; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  const line = holder(new Point(round, 1));
  if (mode !== 0 || round % 100 === 0) console.log(round + ": " + line);
}
