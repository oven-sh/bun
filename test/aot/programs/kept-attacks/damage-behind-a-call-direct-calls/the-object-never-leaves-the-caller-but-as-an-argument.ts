// The caller makes an object that nothing else ever refers to and lends it to a callee, so it may live in the caller's frame. On a rare path the callee damages it, and on a rarer one it keeps it for later.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let mode = 0;
let kept = null as Point | null;
function borrow(p: Point): number {
  if (mode === 1) delete (p as any).x;
  else if (mode === 2) (p as any).z = 3;
  else if (mode === 3) {
    (p as any).y = "kept";
    kept = p;
  }
  return p.y === 1 ? 1 : 2;
}

function overwrite(depth: number): number {
  const a = new Point(-1, -1), b = new Point(-2, -2);
  return depth === 0 ? a.x + b.y : overwrite(depth - 1) + a.y + b.x;
}

function holder(n: number): string {
  const p = new Point(n, 1);
  const before = p.x + p.y;
  const got = borrow(p);
  return before + " " + got + " " + p.x + "," + p.y + "," + Object.keys(p).join("");
}

for (let round = 0; round < 400; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  const line = holder(round);
  overwrite(20);
  if (mode || round === 0) console.log(round + ": " + line + " " + (kept === null ? "-" : kept.x + "," + kept.y));
}
