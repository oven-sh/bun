// Guards that fail once: freeze prototype. It prints what plain Bun prints.
const trip = process.argv[2] === "trip";
const N = Number(process.argv[3] ?? 10000000);
const variant = process.argv[4] ?? "prototype";

class Shape {
  constructor(side) {
    this.side = side;
  }
  area(scale) {
    return this.side * scale;
  }
}
class Square extends Shape {
  twice(scale) {
    return this.area(scale) * 2;
  }
}
if (process.argv.length > 9) Shape.prototype[process.argv[9]] = process.argv[10];
if (process.argv.length > 9) Square.prototype[process.argv[9]] = process.argv[10];
if (trip && variant === "prototype") Object.freeze(Shape.prototype);
if (trip && variant === "class") Object.freeze(Shape);

function run(shapes) {
  let sum = 0;
  for (let i = 0; i < N; i++) sum = (sum + shapes[i & 1].area(i & 7)) | 0;
  return sum;
}
console.log(variant, run([new Shape(3), new Square(5)]));
