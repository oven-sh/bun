// An abstract class can be created by code that the checker does not see through. A call of its abstract method on such an object throws as it does in plain JavaScript.
abstract class Shape {
  constructor(public size: number) {}
  abstract area(): number;
  describe(): string {
    return "size " + this.size;
  }
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

function areaOf(shape: Shape): number {
  return shape.area();
}

function describe(shape: Shape): string {
  return shape.describe();
}

function create(Class: any, size: number): any {
  return new Class(size);
}

function attempt(what: string, run: () => unknown): void {
  try {
    console.log(what, run());
  } catch (error) {
    console.log(what, "threw", error instanceof TypeError);
  }
}

attempt("the subclasses", () => areaOf(new Circle(2)) + " " + areaOf(new Square(3)));
attempt("the abstract class, its own method", () => describe(create(Shape, 5) as Shape));
attempt("the abstract class, the abstract method", () => areaOf(create(Shape, 5) as Shape));
attempt("a subclass created the same way", () => areaOf(create(Circle, 4) as Shape));
attempt("null", () => areaOf(null as unknown as Shape));
attempt("the subclasses again", () => areaOf(new Circle(2)) + " " + areaOf(new Square(3)));
