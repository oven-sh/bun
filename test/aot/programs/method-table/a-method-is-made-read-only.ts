// A method is made read-only on its prototype. Stores to the prototype and to instances throw a TypeError and change nothing; Object.defineProperty still replaces it, on an instance and on the prototype.
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

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

const shapes: Shape[] = [new Shape(2), new Circle(3), new Dot(4)];

Object.defineProperty(Shape.prototype, "area", { writable: false });
note("read-only", areas(shapes));
note("a store to the prototype", attempt(() => storeTo(Shape.prototype)));
note("afterwards", areas(shapes));
note("a store to a shape", attempt(() => storeTo(shapes[0])));
note("a store to a dot", attempt(() => storeTo(shapes[2])));
note("afterwards", areas(shapes));
note("a store to a circle", attempt(() => storeTo(shapes[1])));
note("afterwards", areas(shapes));
Object.defineProperty(shapes[2], "area", { value: () => 50, configurable: true });
note("defined on the dot", areas(shapes));
Object.defineProperty(Shape.prototype, "area", { value: () => 7 });
note("defined on the prototype", areas(shapes));
Object.freeze(Circle.prototype);
note("a store to the frozen prototype of the subclass", attempt(() => storeTo(Circle.prototype)));
note("a new circle", new Circle(2).area());
note("a store to a new circle", attempt(() => storeTo(new Circle(2))));

export {};
