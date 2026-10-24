// The plainest form of the trap: deep does the damage and throws, middle catches and returns a number as always, and holder, which saw a usual return, reads the object. Four kinds of damage, one after the other.
class Square {
  side: number;
  tag: boolean;
  constructor(side: number) {
    this.side = side;
    this.tag = true;
  }
  area(): number {
    return this.side * this.side;
  }
}
const area = Square.prototype.area;

let mode = 0;
function deep(s: Square): void {
  if (mode === 0) return;
  if (mode === 1) delete (s as any).side;
  else if (mode === 2) (s as any).tag = "yes";
  else if (mode === 3) Square.prototype.area = () => -1;
  else if (mode === 4) Object.freeze(s);
  throw new Error("thrown");
}
function middle(s: Square): number {
  try {
    deep(s);
    return 1;
  } catch {
    return 2;
  }
}

function holder(s: Square): string {
  const before = s.side + "," + s.tag + "," + s.area();
  const got = middle(s);
  let stored = "stored";
  const side = s.side, tag = s.tag === true, size = s.area();
  try {
    s.side = 3;
  } catch (error) {
    stored = (error as Error).name;
  }
  return before + " " + got + " " + side + "," + tag + "," + size + "," + stored + "," + s.side;
}

for (let round = 0; round < 500; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  if (mode === 5) mode = 0;
  const line = holder(new Square(round));
  Square.prototype.area = area;
  if (mode || round === 0) console.log(round + ": " + line);
}
