// The honest twin of the programs that replace a method on a prototype: the same family and the same calls, from a list, a parameter, a field and a new object, and nothing is ever changed. One number is printed.
class Shape {
  constructor(public side: number) {}
  area(): number {
    return this.side * this.side;
  }
  edge(): number {
    return 4 * this.side;
  }
}
class Circle extends Shape {
  area(): number {
    return 3 * this.side * this.side;
  }
  edge(): number {
    return 6 * this.side;
  }
}
class Dot extends Shape {}

class Frame {
  constructor(public inner: Shape) {}
  area(): number {
    return this.inner.area() + this.inner.edge();
  }
}

function areas(shapes: Shape[]): number {
  let sum = 0;
  for (const shape of shapes) sum += shape.area();
  return sum;
}

function twice(shape: Shape): number {
  return shape.area() * 1000 + shape.area();
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const shapes: Shape[] = [new Shape(2), new Circle(3), new Dot(4)];
note(areas(shapes));
for (const shape of shapes) note(twice(shape));
for (const shape of shapes) note(new Frame(shape).area());
note(new Shape(5).area() + new Circle(5).area() + new Dot(5).area());
let sum = 0;
for (let round = 0; round < 1000; round++) sum += areas(shapes);
note(sum);
console.log(checksum);

export {};
