class Shape {
  static kind = "shape";
  constructor(name) {
    this.name = name;
  }
  area() {
    return 0;
  }
  toString() {
    return `${this.name}(${this.area().toFixed(2)})`;
  }
}
class Circle extends Shape {
  static kind = "circle";
  constructor(r) {
    super("circle");
    this.r = r;
  }
  area() {
    return Math.PI * this.r ** 2;
  }
}
class Square extends Shape {
  constructor(s) {
    super("square");
    this.s = s;
  }
  area() {
    return this.s * this.s;
  }
}
const shapes = [new Circle(1), new Square(2), new Shape("none")];
console.log(shapes.map(String).join(" "), Circle.kind, Square.kind);
console.log(shapes.reduce((a, s) => a + s.area(), 0).toFixed(3));
