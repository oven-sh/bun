// Reflect.construct(f, arguments, Class): f makes the object, under Class.prototype, and no constructor of the class or above it runs.
function show(o) {
  try {
    return [String(o.side), o.side + 1, String(o.text), o.text?.length, String(o.box), o.box?.n, Object.keys(o).join()].join(" ");
  } catch (error) {
    return "threw " + error.name;
  }
}
class Shape {
  constructor(side) {
    this.side = side;
    this.text = "t" + side;
    this.box = { n: side };
  }
}
class Circle extends Shape {}
const circle = Reflect.construct(function () {}, [3], Circle);
console.log(show(circle), circle instanceof Circle, circle instanceof Shape);
const shape = Reflect.construct(function () {}, [3], Shape);
console.log(show(shape), shape instanceof Circle, shape instanceof Shape);
const some = Reflect.construct(
  function (side) {
    this.side = side;
  },
  [3],
  Circle,
);
console.log(show(some), some instanceof Circle);
console.log(show(new Circle(4)), show(new Shape(1.5)));
