// A loop calls one method on twelve objects of three classes, and in the middle of the loop the method is replaced: the objects before keep the old answer, the objects after get the new one. One number is printed.
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

function areas(shapes: Shape[], at: number, change: () => void): number {
  let sum = 0;
  for (let i = 0; i < shapes.length; i++) {
    if (i === at) change();
    sum += shapes[i].area();
  }
  return sum;
}

function nothing(): void {}
function replaceTheBaseMethod(): void {
  Shape.prototype.area = () => 1000;
}
function replaceTheOverride(): void {
  Circle.prototype.area = () => 100000;
}
function deleteTheOverride(): void {
  Reflect.deleteProperty(Circle.prototype, "area");
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const shapes: Shape[] = [];
for (let i = 0; i < 4; i++) shapes.push(new Shape(i + 1), new Circle(i + 1), new Dot(i + 1));

note(areas(shapes, -1, nothing));
note(areas(shapes, 6, replaceTheBaseMethod));
note(areas(shapes, -1, nothing));
note(areas(shapes, 4, replaceTheOverride));
note(areas(shapes, -1, nothing));
note(areas(shapes, 10, deleteTheOverride));
note(areas(shapes, -1, nothing));
console.log(checksum);

export {};
