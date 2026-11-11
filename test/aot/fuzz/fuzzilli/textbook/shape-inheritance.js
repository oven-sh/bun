class Shape {
  constructor(name) {
    this.name = name;
  }
  area() {
    return 0;
  }
  toString() {
    return this.name + " of " + this.area();
  }
}
class Square extends Shape {
  constructor(side) {
    super("square");
    this.side = side;
  }
  area() {
    return this.side * this.side;
  }
}
console.log(String(new Square(3)), String(new Shape("nothing")), new Square(1) instanceof Shape);
