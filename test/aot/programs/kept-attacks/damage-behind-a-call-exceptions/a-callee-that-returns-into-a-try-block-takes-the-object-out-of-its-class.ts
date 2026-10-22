// A typed caller reads an object, makes a call and reads it again. The call stands in a try block and nothing is thrown, so the catch block must not run. The callee gives the object the prototype of the base class.
class Shape {
  kind(): string {
    return "shape";
  }
  area(): number {
    return 0;
  }
}
class Square extends Shape {
  side: number;
  constructor(side: number) {
    super();
    this.side = side;
  }
  area(): number {
    return this.side * this.side;
  }
}
const areaOfSquare = Square.prototype.area;
const kindOfShape = Shape.prototype.kind;

let victim: Square | null = null;
function strike(): boolean {
  const target = victim;
  if (target === null) return false;
  victim = null;
  Object.setPrototypeOf(target, Shape.prototype);
  return true;
}

function callee(round: number): number {
  strike();
  return round & 3;
}

function holder(p: Square, round: number): string {
  const before = p.area() + p.kind();
  let got: number;
  try {
    got = callee(round);
  } catch {
    got = -1;
  }
  const after = p.area() + "," + p.kind() + "," + p.side + "," + (p instanceof Square);
  return before + " " + got + " " + after;
}

function outer(round: number): string {
  const p: Square = new Square(round);
  const before = p.area() + p.kind();
  if (round === 150 || round === 151 || round === 299) victim = p;
  const inner = holder(p, round);
  const after = p.area() + "," + p.kind() + "," + p.side + "," + (p instanceof Square);
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
}
console.log("digest " + digest);
