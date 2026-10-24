// An override is deleted, so that its objects find the method of the parent. Then the method of the parent is deleted too, and a call throws a TypeError. Then both are put back, the parent's first. One number is printed.
class Shape {
  constructor(public side: number) {}
  area(): number {
    return this.side * this.side;
  }
}
class Circle extends Shape {
  area(): number {
    return 3 * this.side * this.side;
  }
}
class Dot extends Shape {}

function areaOf(shape: Shape): number {
  return shape.area();
}

function attempt(shape: Shape): number {
  try {
    return areaOf(shape);
  } catch (error) {
    return error instanceof TypeError ? -1 : -2;
  }
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const shapes: Shape[] = [new Shape(2), new Circle(3), new Dot(4)];
const ofShape = Shape.prototype.area;
const ofCircle = Circle.prototype.area;

for (const shape of shapes) note(attempt(shape));
Reflect.deleteProperty(Circle.prototype, "area");
for (const shape of shapes) note(attempt(shape));
Reflect.deleteProperty(Shape.prototype, "area");
for (const shape of shapes) note(attempt(shape));
note(attempt(new Circle(5)));
Shape.prototype.area = ofShape;
for (const shape of shapes) note(attempt(shape));
Circle.prototype.area = ofCircle;
for (const shape of shapes) note(attempt(shape));
Reflect.deleteProperty(Shape.prototype, "area");
for (const shape of shapes) note(attempt(shape));
console.log(checksum);

export {};
