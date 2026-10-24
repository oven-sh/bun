// A typed caller reads an object, makes a call and reads it again. A function that then throws. The caller itself catches. That function replaces a method on the prototype object of the class.
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

let victim: Square | null = null;
let spark: number = 0;
const hot: any = {
  valueOf(): number {
    spark = 0;
    const target = victim;
    if (target === null) return 0;
    victim = null;
    Square.prototype.area = function (this: Square) {
      return -this.side;
    };
    return 1;
  },
};
function strike(): boolean {
  return spark * 1 === 1;
}

function risky(): void {
  if (strike()) throw new Error("behind the damage");
}
function callee(round: number): number {
  risky();
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
  Square.prototype.area = areaOfSquare;
}
console.log("digest " + digest);
