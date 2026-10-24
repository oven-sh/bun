abstract class Shape {
  readonly area: number;
  constructor() { this.area = this.computeArea(); }
  abstract computeArea(): number;
}
class Square extends Shape {
  constructor(private side: number) { super(); }
  computeArea(): number { return this.side * this.side; }
}
class Unit extends Shape {
  computeArea(): number { return 1; }
}
const s = new Square(3);
console.log(s.area, Number.isNaN(s.area), s.computeArea(), new Unit().area);
