// Two methods of a family are replaced on their prototypes before any object exists and before the first call: no call ever finds the methods that the classes define.
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

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

Shape.prototype.area = function () {
  return this.side;
};
Circle.prototype.area = function () {
  return -10 * this.side;
};

const shapes: Shape[] = [new Shape(2), new Circle(3), new Dot(4)];
note("the first call", areas(shapes));
note("the second call", areas(shapes));
note("a shape", new Shape(5).area());
note("a circle", new Circle(5).area());
note("a dot", new Dot(5).area());

export {};
