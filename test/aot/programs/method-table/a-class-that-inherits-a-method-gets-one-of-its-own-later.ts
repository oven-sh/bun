// Dot defines no area() and inherits Shape's. One store, in the middle of the program, gives Dot.prototype an area() of its own. Every call before that store finds Shape's: from a list, from the base constructor, and the first of two calls in one function. Every call after it, on old, new and lower objects, finds the new one.
class Shape {
  size: number;
  constructor(public side: number) {
    this.size = this.area();
  }
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
class Speck extends Dot {}

function areas(shapes: Shape[]): number {
  let sum = 0;
  for (const shape of shapes) sum = sum * 100 + shape.area();
  return sum;
}

function twice(shape: Shape, change: () => void): number {
  const first = shape.area();
  change();
  return first * 1000 + shape.area();
}

function nothing(): void {}
function addToDot(): void {
  Dot.prototype.area = function () {
    return this.side + 1;
  };
}

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

const shapes: Shape[] = [new Shape(2), new Circle(3), new Dot(4), new Speck(5)];
note("before the store", areas(shapes));
for (const shape of shapes) note("measured by the constructor", shape.size);
note("a dot, twice", twice(shapes[2], nothing));
note("a dot, around the store", twice(shapes[2], addToDot));
note("after the store", areas(shapes));
note("a dot, twice", twice(shapes[2], nothing));
for (const shape of [new Shape(2), new Circle(3), new Dot(4), new Speck(5)]) note("measured by the constructor", shape.size);

export {};
