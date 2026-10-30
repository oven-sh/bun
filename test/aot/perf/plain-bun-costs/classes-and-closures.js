let sum = 0;
class Shape { #id; static made = 0; constructor(id) { this.#id = id; Shape.made++; } get id() { return this.#id; } area() { return 0; } describe() { return `${this.constructor.name}:${this.area()}`; } }
class Square extends Shape { constructor(id, side) { super(id); this.side = side; } area() { return this.side * this.side; } }
class Circle extends Shape { constructor(id, radius) { super(id); this.radius = radius; } area() { return Math.round(3.14159 * this.radius ** 2); } }
class Tagged extends Square { tag = "t"; area() { return super.area() + this.tag.length; } }
function* pairs(n) { for (let i = 0; i < n; i++) yield [i, i * 2]; }
const adder = a => b => c => a + b + c;
const compose = (...fs) => x => fs.reduceRight((value, f) => f(value), x);
for (let round = 0; round < 25; round++) {
  const shapes = [];
  for (let i = 0; i < 6000; i++) shapes.push(i % 3 === 0 ? new Square(i, i % 9) : i % 3 === 1 ? new Circle(i, i % 5) : new Tagged(i, 2));
  for (const shape of shapes) sum += shape.area() + shape.id + shape.describe().length;
  for (const [a, b] of pairs(6000)) sum += a + b;
  for (let i = 0; i < 6000; i++) { const { x, y: { z = 4 } = {}, ...others } = { x: i, y: i & 1 ? { z: i } : undefined, w: 1, v: 2 }; sum += x + z + others.w + adder(i)(1)(2) + compose(n => n + 1, n => n * 2)(i); }
  sum += Math.max(...shapes.slice(0, 200).map(shape => shape.area())) + (function () { return arguments.length; }).apply(null, shapes.slice(0, 50)) + [1, 2, 3].map(Number.prototype.toFixed.call.bind(Number.prototype.toFixed)).length;
  const proxy = new Proxy({ n: round }, { get: (target, key) => (key in target ? target[key] : 1) });
  for (let i = 0; i < 6000; i++) sum += proxy.n + proxy.other + (Symbol.iterator in shapes ? 1 : 0) + (typeof shapes[i] === "object" ? 1 : 0) + BigInt.asUintN(8, BigInt(i)).toString().length;
}
console.log(sum + Shape.made);
