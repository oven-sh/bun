// In `p.x += touch(p)` the old value is read first, then the right side runs, then the sum is stored. The right side makes the field an accessor, deletes it, freezes the object, or makes the field read-only.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let mode = 0;
let stored = "";
function touch(p: Point): number {
  if (mode === 1) {
    Object.defineProperty(p, "x", {
      get: () => -7,
      set(value: number) {
        stored += value + ";";
      },
    });
  } else if (mode === 2) delete (p as any).x;
  else if (mode === 3) Object.freeze(p);
  else if (mode === 4) Object.defineProperty(p, "x", { writable: false });
  return 1;
}

function holder(p: Point): string {
  let outcome = "stored";
  try {
    p.x += touch(p);
  } catch (error) {
    outcome = (error as Error).name;
  }
  return outcome + " " + p.x + " " + Object.keys(p).join("");
}

for (let round = 0; round < 500; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  stored = "";
  const line = holder(new Point(round, 1));
  if (mode || round === 0) console.log(round + ": " + line + " " + stored);
}
