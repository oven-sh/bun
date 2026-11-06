
class Circle { constructor(public r: number) {} area() { return 3 * this.r * this.r; } }
class Square { constructor(public s: number) {} area() { return this.s * this.s; } }
class Strip { constructor(public w: number) {} area() { return this.w; } }
function total(shapes: (Circle | Square)[]): number {
  let sum = 0;
  for (const shape of shapes) sum += shape.area();
  return sum;
}
const n = Number(process.argv[2] ?? 4);
const shapes = [];
for (let i = 0; i < n; i++) shapes.push(i % 2 ? new Circle(i) : new Square(i));
console.log(total(shapes), new Strip(2).area());
