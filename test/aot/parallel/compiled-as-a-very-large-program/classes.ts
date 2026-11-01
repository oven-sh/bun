// Flags: --aot-limit=MaxWarmCodeValues:1
// A very large program is compiled another way: a function of some size that nothing in the text says may run gets a short list of passes. These functions are such, and they run.
// Classes: fields, private members, accessors, statics, inheritance, super, what a constructor returns, instanceof and conversions.
abstract class Shape {
  static count = 0;
  static #registry = new Map<string, Shape>();
  readonly id: number;
  #label: string;
  protected tags: string[] = [];
  constructor(label: string) {
    this.id = ++Shape.count;
    this.#label = label;
    Shape.#registry.set(label, this);
  }
  abstract area(): number;
  get label() {
    return this.#label;
  }
  set label(value: string) {
    Shape.#registry.delete(this.#label);
    this.#label = value.trim();
    Shape.#registry.set(this.#label, this);
  }
  static find(label: string) {
    return Shape.#registry.get(label);
  }
  static has(value: unknown) {
    return typeof value === "object" && value !== null && #label in value;
  }
  describe() {
    return `${this.constructor.name} ${this.#label} #${this.id} ${this.area().toFixed(2)} [${this.tags.join()}]`;
  }
  [Symbol.toPrimitive](hint: string) {
    return hint === "number" ? this.area() : this.describe();
  }
}
class Circle extends Shape {
  constructor(
    label: string,
    public radius: number,
  ) {
    super(label);
    this.tags.push("round");
  }
  area() {
    return Math.PI * this.radius ** 2;
  }
}
class Rectangle extends Shape {
  static unit = new Rectangle("unit", 1, 1);
  constructor(
    label: string,
    public width: number,
    public height: number,
  ) {
    super(label);
    this.tags.push("cornered");
  }
  area() {
    return this.width * this.height;
  }
  describe() {
    return super.describe() + ` ${this.width}x${this.height}`;
  }
}
class Square extends Rectangle {
  constructor(label: string, side: number) {
    super(label, side, side);
    this.tags.push("equal");
  }
  get side() {
    return this.width;
  }
  set side(value: number) {
    this.width = this.height = value;
  }
}
function build() {
  const circle = new Circle("c", 2);
  const rectangle = new Rectangle("r", 2, 3);
  const square = new Square("s", 4);
  console.log(circle.describe());
  console.log(rectangle.describe());
  console.log(square.describe());
  square.side = 5;
  square.label = "  bigger  ";
  console.log(square.describe(), square.side, Shape.find("bigger") === square, Shape.find("s"));
  console.log(`${circle}`, +rectangle, +circle > +rectangle, Shape.count, Rectangle.unit.id);
  console.log(square instanceof Rectangle, square instanceof Circle, Shape.has(square), Shape.has({}), Shape.has(null));
  console.log(Object.keys(square).join(), Object.getOwnPropertyNames(Square.prototype).join());
  return [circle, rectangle, square];
}
function misuse(shapes: Shape[]) {
  const attempts: (() => unknown)[] = [
    () => (Shape as any)("x"),
    () => new (Shape as any)("abstract").area(),
    () => Object.getOwnPropertyDescriptor(Shape.prototype, "label")!.get!.call({}),
    () => (shapes[0] as any).missing.deeper,
    () => ((shapes[1] as any).id = 9),
    () => Reflect.construct(Square, ["reflected", 2], Circle).describe(),
  ];
  const results: string[] = [];
  results.push(attempt(attempts[0]), attempt(attempts[1]), attempt(attempts[2]));
  results.push(attempt(attempts[3]), attempt(attempts[4]), attempt(attempts[5]));
  console.log(results.join("\n"));
}
function attempt(f: () => unknown) {
  try {
    return String(f());
  } catch (error) {
    return (error as Error).constructor.name + ": " + (error as Error).message;
  }
}
// Each is called twice from code that runs once: a function that is called once counts as one that runs.
misuse(build());
misuse(build());
