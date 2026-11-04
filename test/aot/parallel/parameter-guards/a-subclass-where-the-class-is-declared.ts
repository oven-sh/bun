// An instance of a class below the declared one is of the declared type: it has the fields of the class above in front of its own, and may answer with methods of its own.
class Shape {
  name = "shape";
  sides = 0;
  area() {
    return 0;
  }
  describe() {
    return this.name + " " + this.sides + " " + this.area();
  }
}
class Square extends Shape {
  side = 2;
  constructor(side: number) {
    super();
    this.name = "square";
    this.sides = 4;
    this.side = side;
  }
  area() {
    return this.side * this.side;
  }
}
class Cube extends Square {
  depth = 3;
  constructor(side: number) {
    super(side);
    this.name = "cube";
    this.sides = 6;
  }
  area() {
    return super.area() * 6 + this.depth - this.depth;
  }
}
class Unrelated {
  name = "unrelated";
  sides = -1;
  area() {
    return -2;
  }
}
function report(shape: Shape): string {
  const name = shape.name;
  const sides = shape.sides;
  const area = shape.area();
  return name + "|" + sides + "|" + area + "|" + shape.describe();
}
function sideOf(square: Square): number {
  const side = square.side;
  const sides = square.sides;
  return side * 100 + sides;
}
const any = (value: unknown): any => value;
const shapes: any[] = [new Shape(), new Square(2), new Cube(3), new Unrelated(), new Square(5), Object.create(Square.prototype), Object.assign(Object.create(Shape.prototype), { name: "made", sides: 9 }), new Shape()];
for (const shape of shapes) {
  try {
    console.log(report(shape));
  } catch (error) {
    console.log("threw", (error as Error).message);
  }
}
for (const shape of shapes) console.log(String(sideOf(any(shape))));
