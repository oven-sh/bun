// A typed caller reads an object, makes a call and reads it again. The catch block of the callee replaces a method on the prototype object of the class.
// `strike` reads a field of a typed object. In the rounds of the damage that object is one whose field has become an accessor, so the read leaves its typed path, goes by name and runs the getter, which does the damage.
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
class Fuse {
  spark: number;
  constructor(spark: number) {
    this.spark = spark;
  }
}
const cold = new Fuse(0);
const lit = new Fuse(0);
let fuse: Fuse = cold;
Object.defineProperty(lit, "spark", {
  get(): number {
    fuse = cold;
    const target = victim;
    if (target === null) return 0;
    victim = null;
    Square.prototype.area = function (this: Square) {
      return -this.side;
    };
    return 1;
  },
  enumerable: true,
  configurable: true,
});
function strike(): boolean {
  return fuse.spark === 1;
}

function fails(round: number): number {
  if (round % 50 < 2 || round === 299) throw new Error("now and then");
  return round & 3;
}
function callee(round: number): number {
  try {
    return fails(round) + 1;
  } catch {
    strike();
    return -1;
  }
}

function holder(p: Square, round: number): string {
  const before = p.area() + p.kind();
  const got = callee(round);
  const after = p.area() + "," + p.kind() + "," + p.side + "," + (p instanceof Square);
  return before + " " + got + " " + after;
}

function outer(round: number): string {
  const p: Square = new Square(round);
  const before = p.area() + p.kind();
  if (round === 150 || round === 151 || round === 299) {
    victim = p;
    fuse = lit;
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
