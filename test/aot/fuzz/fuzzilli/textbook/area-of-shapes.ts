class Square {
  side: number;
  label: string;
  constructor(side: number) {
    this.side = side;
    this.label = "square";
  }
}
class Circle {
  radius: number;
  constructor(radius: number) {
    this.radius = radius;
  }
}
class Triangle {
  base: number;
  height: number;
  constructor(base: number, height: number) {
    this.base = base;
    this.height = height;
  }
}
function area(shape: Square | Circle | Triangle): number {
  if (shape instanceof Square) return shape.side * shape.side;
  if ("radius" in shape) return 3 * shape.radius * shape.radius;
  return (shape.base * shape.height) / 2;
}
const shapes = [new Square(2), new Circle(1), new Triangle(3, 4), new Square(5)];
let sum = 0;
for (const shape of shapes) sum += area(shape);
console.log(sum, shapes.length);
