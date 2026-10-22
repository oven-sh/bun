// A closure captures an object that its maker has read, so the value travels into the closure's body as a hidden argument. A call between the making and the calling of the closure damages the object.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let mode = 0;
function touch(p: Point): void {
  if (mode === 1) delete (p as any).x;
  else if (mode === 2) Object.defineProperty(p, "y", { get: () => -7 });
  else if (mode === 3) (p as any).x = "text";
}

function holder(p: Point): string {
  const before = p.x + p.y;
  const sum = () => p.x + p.y;
  const first = sum();
  touch(p);
  return before + " " + first + " " + sum() + " " + p.x + " " + p.y;
}

for (let round = 0; round < 400; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  const line = holder(new Point(round, 1));
  if (mode !== 0 || round % 100 === 0) console.log(round + ": " + line);
}
