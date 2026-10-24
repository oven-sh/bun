// Two methods of a family are replaced on their prototypes before any object exists and before the first call: no call ever finds the methods that the classes define. One number is printed.
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

function areas(shapes: Shape[]): number {
  let sum = 0;
  for (const shape of shapes) sum += shape.area();
  return sum;
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

Shape.prototype.area = function () {
  return this.side;
};
Circle.prototype.area = function () {
  return -10 * this.side;
};

const shapes: Shape[] = [new Shape(2), new Circle(3), new Dot(4)];
note(areas(shapes));
note(areas(shapes));
note(new Shape(5).area());
note(new Circle(5).area());
note(new Dot(5).area());
console.log(checksum);

export {};
