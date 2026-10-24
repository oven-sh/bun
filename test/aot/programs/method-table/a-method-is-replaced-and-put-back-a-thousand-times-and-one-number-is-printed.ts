// A method and its override are replaced and put back a thousand times, with calls after every change: each call finds what was stored last, whether that is the compiled method or another function. One number is printed.
class Shape {
  constructor(public side: number) {}
  area(): number {
    return this.side * this.side;
  }
}
class Circle extends Shape {
  area(): number {
    return 3 * this.side * this.side;
  }
}
class Dot extends Shape {}

function areas(shapes: Shape[]): number {
  let sum = 0;
  for (const shape of shapes) sum += shape.area();
  return sum;
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const shapes: Shape[] = [new Shape(2), new Circle(3), new Dot(4)];
const ofShape = Shape.prototype.area;
const ofCircle = Circle.prototype.area;

let replaced = 0;
let restored = 0;
let exchanged = 0;
for (let round = 0; round < 1000; round++) {
  Shape.prototype.area = () => round;
  replaced += areas(shapes);
  Circle.prototype.area = ofShape;
  Shape.prototype.area = ofCircle;
  exchanged += areas(shapes);
  Shape.prototype.area = ofShape;
  Circle.prototype.area = ofCircle;
  restored += areas(shapes);
}
note(replaced);
note(exchanged);
note(restored);
console.log(checksum);

export {};
