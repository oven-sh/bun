// A call of an abstract method on the abstract class is resolved to its implementations: no call by name is left.
// IR= 0 areaOf CallMethod
// IR= 0 total CallMethod
abstract class Shape {
  constructor(public size: number) {}
  abstract area(): number;
}

class Circle extends Shape {
  isCircle = true;
  area(): number {
    return this.size * 3;
  }
}

class Square extends Shape {
  isSquare = true;
  area(): number {
    return this.size * this.size;
  }
}

class Ring extends Circle {
  isRing = true;
  area(): number {
    return super.area() - 1;
  }
}

function areaOf(shape: Shape): number {
  return shape.area();
}

function total(shapes: Shape[]): number {
  let sum = 0;
  for (const shape of shapes) sum += shape.area();
  return sum;
}

const shapes: Shape[] = [new Circle(2), new Square(3), new Ring(4)];
console.log(shapes.map(areaOf).join(), total(shapes));
