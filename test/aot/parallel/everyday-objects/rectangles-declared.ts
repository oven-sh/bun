// Classes with declared fields, parameter properties and an abstract base
abstract class Shape {
  abstract area(): number;
  constructor(protected readonly name: string) {}
  describe(): string {
    return `${this.name} of ${this.area()}`;
  }
}
class Rectangle extends Shape {
  constructor(private width: number, private height: number) {
    super("rectangle");
  }
  area(): number {
    return this.width * this.height;
  }
  grow(by: number): this {
    this.width += by;
    this.height += by;
    return this;
  }
}
const show = (width: number, height: number): string => new Rectangle(width, height).grow(1).describe() + " " + Object.keys(new Rectangle(1, 1)).join();
console.log(show(1, 2));
console.log(show(10, 20));
console.log(show(0, -1));
