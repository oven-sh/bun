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
const first = new Circle(9);
const parents = [Shape, function () {}];
for (let turn = 0; turn < 4; turn++) {
  Object.setPrototypeOf(Circle, parents[turn & 1]);
  console.log(show(new Circle(turn)));
}
console.log(show(first), show(new Shape(1.5)));
