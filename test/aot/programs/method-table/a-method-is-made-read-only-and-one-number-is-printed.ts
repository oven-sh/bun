// A method is made read-only on its prototype. Stores to the prototype and to instances throw a TypeError and change nothing; Object.defineProperty still replaces it, on an instance and on the prototype. One number is printed.
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

function attempt(run: () => number): number {
  try {
    return run();
  } catch (error) {
    return error instanceof TypeError ? -1 : -2;
  }
}

function storeTo(shape: Shape): number {
  shape.area = () => 1000;
  return 1;
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const shapes: Shape[] = [new Shape(2), new Circle(3), new Dot(4)];

Object.defineProperty(Shape.prototype, "area", { writable: false });
note(areas(shapes));
note(attempt(() => storeTo(Shape.prototype)));
note(areas(shapes));
note(attempt(() => storeTo(shapes[0])));
note(attempt(() => storeTo(shapes[2])));
note(areas(shapes));
note(attempt(() => storeTo(shapes[1])));
note(areas(shapes));
Object.defineProperty(shapes[2], "area", { value: () => 50, configurable: true });
note(areas(shapes));
Object.defineProperty(Shape.prototype, "area", { value: () => 7 });
note(areas(shapes));
Object.freeze(Circle.prototype);
note(attempt(() => storeTo(Circle.prototype)));
note(new Circle(2).area());
note(attempt(() => storeTo(new Circle(2))));
console.log(checksum);

export {};
