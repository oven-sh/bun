class Shape {
  static make() {
    return "made by the class";
  }
  area() {
    return 4;
  }
}
const shape = new Shape();
console.log(shape);
const either = process.argv.length > 5 ? JSON.parse("{}") : shape;
console.log(either.constructor.make(), either.area());
