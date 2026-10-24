// One function calls the same method of the same object twice, and what it calls in between replaces the method: on the class of the object, on its parent, or on a class that the object does not look at. One number is printed.
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

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const shape = new Shape(5);
const circle = new Circle(3);
const dot = new Dot(4);

note(twice(shape, nothing));
note(twice(circle, nothing));
note(twice(dot, nothing));
note(twice(circle, replaceOnCircle));
note(twice(circle, replaceOnShape));
note(twice(shape, nothing));
note(twice(dot, replaceOnShapeAgain));
note(twice(shape, replaceOnCircleAgain));
note(twice(circle, nothing));
console.log(checksum);

export {};
