// A method is called on a union of two classes. The test of the shape proves the receiver's class, so the typed method is called, not the entry that tests `this` again and boxes the result.
// IR= 0 total CallMethod
// IR= 0 total CallDirect
// IR= 1 total TypeTest v[0-9]+ testedType==?L[0-9]+
class Circle {
  constructor(public radius: number) {}
  area(): number {
    return 3 * this.radius * this.radius;
  }
}

class Square {
  constructor(public side: number) {}
  area(): number {
    return this.side * this.side;
  }
}

function total(shapes: (Circle | Square)[]): number {
  let sum = 0;
  for (let i = 0; i < shapes.length; i++) sum += shapes[i].area();
  return sum;
}

console.log(total([new Circle(1), new Square(2), new Circle(3)]));
