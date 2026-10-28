class Shape {
  constructor(public side: number) {}
  area(): number {
    return this.side;
  }
}
class Circle extends Shape {}
class Dot extends Shape {}
Object.setPrototypeOf(Circle, function () {});
function areas(shapes: Shape[]): number {
  let sum = 0;
  for (const shape of shapes) sum += shape.area();
  return sum;
}
const shapes = [new Shape(2), new Circle(3), new Dot(4)];
console.log(
  areas(shapes),
  shapes.map(shape => typeof shape.side + ":" + shape.side + ":" + ("side" in shape) + ":" + Object.keys(shape).join()).join(" | "),
  shapes[1] instanceof Circle,
  shapes[1] instanceof Shape,
);
