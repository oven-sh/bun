// Instances of several classes in one list, summed by a method of the same name
class Circle {
  constructor(r) {
    this.r = r;
  }
  area() {
    return this.r * this.r * 3;
  }
}
class Rectangle {
  constructor(w, h) {
    this.w = w;
    this.h = h;
  }
  area() {
    return this.w * this.h;
  }
}
class Square extends Rectangle {
  constructor(w) {
    super(w, w);
  }
}
function total(n) {
  const shapes = [new Circle(n), new Rectangle(n, 2), new Square(n), { area: () => -n }];
  let sum = 0;
  for (let round = 0; round < 3; round++) for (const shape of shapes) sum += shape.area() + round;
  return sum + " " + shapes.map(shape => shape.constructor.name[0]).join("");
}
console.log(total(1));
console.log(total(10));
console.log(total(0));
