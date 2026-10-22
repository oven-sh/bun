// A typed caller reads an object, makes a call and reads it again. The deepest call of a function that calls itself puts the prototype object of the class under another one.
// `strike` multiplies a variable that is declared a number. In the rounds of the damage the variable holds an object, so the multiplication leaves its typed path and runs valueOf, which does the damage.
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
const otherBase = { kind: () => "another base", area: () => -4 };

let victim: Square | null = null;
let spark: number = 0;
const hot: any = {
  valueOf(): number {
    spark = 0;
    const target = victim;
    if (target === null) return 0;
    victim = null;
    Object.setPrototypeOf(Square.prototype, otherBase);
    return 1;
  },
};
function strike(): boolean {
  return spark * 1 === 1;
}

function callee(depth: number): number {
  if (depth === 0) {
    strike();
    return 0;
  }
  return callee(depth - 1) + 1;
}

function holder(p: Square, round: number): string {
  const before = p.area() + p.kind();
  const got = callee((round % 5) + 1);
  const after = p.area() + "," + p.kind() + "," + p.side + "," + (p instanceof Square);
  return before + " " + got + " " + after;
}

function outer(round: number): string {
  const p: Square = new Square(round);
  const before = p.area() + p.kind();
  if (round === 150 || round === 151 || round === 299) {
    victim = p;
    spark = hot;
  }
  const inner = holder(p, round);
  const after = p.area() + "," + p.kind() + "," + p.side + "," + (p instanceof Square);
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
  Object.setPrototypeOf(Square.prototype, Shape.prototype);
}
console.log("digest " + digest);
