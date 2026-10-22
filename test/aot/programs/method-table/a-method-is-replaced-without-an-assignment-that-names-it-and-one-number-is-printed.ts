// Methods are replaced in ways that do not read `Class.prototype.name = ..`: Reflect.set, Object.assign, Object.defineProperties, a name computed at run time, a prototype reached from an instance, and a helper that gets the prototype as an argument. One number is printed.
class Shape {
  constructor(public side: number) {}
  area(): number {
    return this.side * this.side;
  }
  edge(): number {
    return 4 * this.side;
  }
}
class Circle extends Shape {
  area(): number {
    return 3 * this.side * this.side;
  }
  edge(): number {
    return 6 * this.side;
  }
}
class Dot extends Shape {}

function measure(shapes: Shape[]): number {
  let sum = 0;
  for (const shape of shapes) sum += shape.area() * 1000 + shape.edge();
  return sum;
}

function put(target: Shape, name: "area" | "edge", answer: number): void {
  target[name] = () => answer;
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const shapes: Shape[] = [new Shape(2), new Circle(3), new Dot(4)];
const names: ("area" | "edge")[] = ["area", "edge"];

note(measure(shapes));
Reflect.set(Shape.prototype, "area", () => 1);
note(measure(shapes));
Object.assign(Circle.prototype, { edge: () => 2 });
note(measure(shapes));
Object.defineProperties(Shape.prototype, { edge: { value: () => 3, writable: true, configurable: true } });
note(measure(shapes));
put(Circle.prototype, names[shapes.length - 3], 4);
note(measure(shapes));
Object.getPrototypeOf(shapes[2]).area = () => 5;
note(measure(shapes));
for (const name of names) put(Shape.prototype, name, 6);
note(measure(shapes));
Reflect.defineProperty(Dot.prototype, "edge", { value: () => 7, configurable: true });
note(measure(shapes));
console.log(checksum);

export {};
