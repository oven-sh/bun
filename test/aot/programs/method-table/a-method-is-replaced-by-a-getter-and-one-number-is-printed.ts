// Object.defineProperty turns a method on the prototype into a getter: every call runs the getter first and then calls what it answers, with the object as this. A getter that answers a number makes the call a TypeError. One number is printed.
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

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const shapes: Shape[] = [new Shape(2), new Circle(3), new Dot(4)];
const original = Shape.prototype.area;
let reads = 0;

note(areas(shapes));
Object.defineProperty(Shape.prototype, "area", {
  get() {
    reads++;
    return function (this: Shape) {
      return this.side + 100;
    };
  },
  configurable: true,
});
note(areas(shapes));
note(reads);
Object.defineProperty(Circle.prototype, "area", {
  get(this: Circle) {
    reads += this.side;
    return original;
  },
  configurable: true,
});
note(areas(shapes));
note(reads);
Object.defineProperty(Shape.prototype, "area", { get: () => 5, configurable: true });
note(attempt(() => areas(shapes)));
note(areas([shapes[1]]));
Object.defineProperty(Shape.prototype, "area", { value: original, writable: true, configurable: true });
Reflect.deleteProperty(Circle.prototype, "area");
note(areas(shapes));
console.log(checksum);

export {};
