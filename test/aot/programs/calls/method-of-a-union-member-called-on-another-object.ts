// Methods of the members of a union of classes are also taken as values and called on other objects: `this` of a method is only predicted, so each of those calls answers as in plain Bun.
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

class Wheel extends Circle {
  area(): number {
    return super.area() - 1;
  }
}

function total(shapes: (Circle | Square)[]): number {
  let sum = 0;
  for (let i = 0; i < shapes.length; i++) sum += shapes[i].area();
  return sum;
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, String(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof TypeError);
  }
}

const stranger: any = { radius: 2, side: 5 };
const taken: any = new Circle(1).area;
const takenFromSquare: any = Square.prototype.area;

attempt("the union", () => total([new Circle(1), new Square(2), new Wheel(3)]));
attempt("on a plain object", () => taken.call(stranger));
attempt("the other method on a plain object", () => takenFromSquare.call(stranger));
attempt("a circle's method on a square", () => taken.call(new Square(4)));
attempt("a square's method on a circle", () => takenFromSquare.call(new Circle(4)));
attempt("on undefined", () => taken.call(undefined));
attempt("the union afterwards", () => total([new Square(3), new Wheel(2), new Circle(2)]));
