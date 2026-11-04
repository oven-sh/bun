// a getter of a class is named by nothing in the program but a text in the list that JSON.stringify is handed. It has to be in the executable, and it runs
class Shape {
  w: number;
  h: number;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
  }
  get area() {
    return this.w * this.h;
  }
  get perimeter() {
    return 2 * (this.w + this.h);
  }
}
function named(shapes: Shape[]): string {
  return JSON.stringify(shapes, ["area"]);
}
function one(shape: Shape, names: string[]): string {
  return JSON.stringify(shape, names);
}
console.log(named([new Shape(2, 3)]));
for (let i = 1; i < 4; i++) console.log(named([new Shape(i, i + 1), new Shape(i, 1)]));
console.log(one(new Shape(2, 3), ["perimeter", "w"]));
console.log(one(new Shape(2, 3), []));
console.log(JSON.stringify(new Shape(2, 3)));
