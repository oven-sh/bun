// One function calls the same method of the same object twice, and what it calls in between replaces the method: on the class of the object, on its parent, or on a class that the object does not look at.
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

function twice(shape: Shape, change: () => void): number {
  const first = shape.area();
  change();
  return first * 1000 + shape.area();
}

function nothing(): void {}
function replaceOnCircle(): void {
  Circle.prototype.area = function () {
    return this.side + 1;
  };
}
function replaceOnShape(): void {
  Shape.prototype.area = function () {
    return this.side + 2;
  };
}
function replaceOnShapeAgain(): void {
  Shape.prototype.area = function () {
    return this.side + 3;
  };
}
function replaceOnCircleAgain(): void {
  Circle.prototype.area = () => 0;
}

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

const shape = new Shape(5);
const circle = new Circle(3);
const dot = new Dot(4);

note("a shape, no change", twice(shape, nothing));
note("a circle, no change", twice(circle, nothing));
note("a dot, no change", twice(dot, nothing));
note("a circle, its class changes", twice(circle, replaceOnCircle));
note("a circle, its parent changes", twice(circle, replaceOnShape));
note("a shape afterwards", twice(shape, nothing));
note("a dot, its parent changes", twice(dot, replaceOnShapeAgain));
note("a shape, a class below changes", twice(shape, replaceOnCircleAgain));
note("a circle afterwards", twice(circle, nothing));

export {};
