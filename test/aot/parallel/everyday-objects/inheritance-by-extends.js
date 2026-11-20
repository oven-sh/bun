// Three levels of classes with super calls in methods and constructors
class Shape {
  constructor(name) {
    this.name = name;
    this.parts = this.describe();
  }
  describe() {
    return ["shape"];
  }
}
class Polygon extends Shape {
  constructor(name, sides) {
    super(name);
    this.sides = sides;
  }
  describe() {
    return [...super.describe(), "polygon" + this.sides];
  }
}
class Square extends Polygon {
  constructor(size) {
    super("square", 4);
    this.size = size;
  }
  describe() {
    return super.describe().concat(String(this.size));
  }
}
console.log(new Square(2).parts.join(), new Square(2).describe().join());
console.log(new Polygon("p", 5).parts.join(), new Polygon("p", 6).describe().join());
console.log(Object.keys(new Square(9)).join(), new Shape("s").parts.join());
