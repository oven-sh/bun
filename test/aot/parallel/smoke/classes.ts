// Classes: fields, methods, statics, accessors, inheritance.
class Shape {
  static count = 0;
  constructor(public name: string) {
    Shape.count++;
  }
  area(): number {
    return 0;
  }
  describe(): string {
    return `${this.name} has area ${this.area()}`;
  }
}
class Circle extends Shape {
  constructor(private radius: number) {
    super("circle");
  }
  override area(): number {
    return Math.PI * this.radius ** 2;
  }
}
class Square extends Shape {
  side: number;
  constructor(side: number) {
    super("square");
    this.side = side;
  }
  override area(): number {
    return this.side * this.side;
  }
  static unit(): Square {
    return new Square(1);
  }
}
const shapes: Shape[] = [new Circle(1), new Square(2), Square.unit()];
for (const shape of shapes) console.log(shape.describe(), shape instanceof Circle);
console.log(Shape.count);
