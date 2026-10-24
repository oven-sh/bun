// Methods are replaced in ways that do not read `Class.prototype.name = ..`: Reflect.set, Object.assign, Object.defineProperties, a name computed at run time, a prototype reached from an instance, and a helper that gets the prototype as an argument.
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

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

const shapes: Shape[] = [new Shape(2), new Circle(3), new Dot(4)];
const names: ("area" | "edge")[] = ["area", "edge"];

note("at first", measure(shapes));
Reflect.set(Shape.prototype, "area", () => 1);
note("Reflect.set", measure(shapes));
Object.assign(Circle.prototype, { edge: () => 2 });
note("Object.assign", measure(shapes));
Object.defineProperties(Shape.prototype, { edge: { value: () => 3, writable: true, configurable: true } });
note("Object.defineProperties", measure(shapes));
put(Circle.prototype, names[shapes.length - 3], 4);
note("a name computed at run time", measure(shapes));
Object.getPrototypeOf(shapes[2]).area = () => 5;
note("the prototype of an instance", measure(shapes));
for (const name of names) put(Shape.prototype, name, 6);
note("both names in a loop", measure(shapes));
Reflect.defineProperty(Dot.prototype, "edge", { value: () => 7, configurable: true });
note("Reflect.defineProperty", measure(shapes));

export {};
