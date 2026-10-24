export class Shape {
  constructor(public side: number) {}
  area(): number {
    return this.side * this.side;
  }
}
export class Circle extends Shape {
  area(): number {
    return 3 * this.side * this.side;
  }
}
export class Dot extends Shape {}

export function areas(shapes: Shape[]): number {
  let sum = 0;
  for (const shape of shapes) sum += shape.area();
  return sum;
}
