// A constructor stores a field, calls a function that reaches `this` and damages it, and goes on storing and reading. The function that called `new` reads the new object, which it takes for fresh.
let mode = 0;
function register(p: object): number {
  if (mode === 1) delete (p as any).x;
  else if (mode === 2) Object.defineProperty(p, "y", { get: () => -7, set() {}, configurable: true });
  else if (mode === 3) Object.preventExtensions(p);
  else if (mode === 4) Object.setPrototypeOf(p, { z: "inherited" });
  return 1;
}

class Point {
  x: number;
  y: number;
  declare z?: number | string;
  sum: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = 0;
    this.sum = 0;
    register(this);
    this.y = y;
    this.sum = this.x + this.y;
  }
}

function holder(n: number): string {
  const p = new Point(n, 1);
  const read = p.x + "," + p.y + "," + p.sum + "," + p.z;
  let stored = "stored";
  try {
    p.z = 5;
  } catch (error) {
    stored = (error as Error).name;
  }
  return read + " " + stored + " " + p.z + " " + Object.keys(p).join("");
}

for (let round = 0; round < 500; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  const line = holder(round);
  if (mode || round === 0) console.log(round + ": " + line);
}
