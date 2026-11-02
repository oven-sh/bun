// Flags: --aot-heat=everything-is-hot --aot-disable=InlineCalls
// Many classes override a method that returns a number. The call finds its target in the table of methods, and the number comes back as every method returns it:
// a fraction, an integer, minus zero, no number at all. An object that hides the method, and a prototype that gets another one, are looked up by name and answer through the same call.
declare const process: { argv: string[] };
const seed: number = process.argv.length > 99 ? 7 : 3;
const out: string[] = [];
function show(name: string, value: unknown): void {
  out.push(name + " " + (Object.is(value, -0) ? "-0" : String(value)) + " " + typeof value);
}

abstract class Shape {
  size: number;
  constructor(size: number) {
    this.size = size;
  }
  abstract area(): number;
  abstract corners(): number;
  abstract label(): number | undefined;
  abstract scaled(factor: number): number;
}
class Square extends Shape {
  area(): number { return this.size * this.size; }
  corners(): number { return 4; }
  label(): number | undefined { return this.size > 3 ? this.size : undefined; }
  scaled(factor: number): number { return this.size * factor; }
}
class Disc extends Shape {
  area(): number { return 3.25 * this.size * this.size; }
  corners(): number { return 0; }
  label(): number | undefined { return undefined; }
  scaled(factor: number): number { return this.size * factor * 2; }
}
class Triangle extends Shape {
  area(): number { return this.size * this.size / 2; }
  corners(): number { return 3; }
  label(): number | undefined { return 0.5; }
  scaled(factor: number): number { return this.size / factor; }
}
class Line extends Shape {
  area(): number { return 0; }
  corners(): number { return 2; }
  label(): number | undefined { return -0; }
  scaled(factor: number): number { return -0 * factor; }
}
class Ring extends Shape {
  area(): number { return 2 * this.size; }
  corners(): number { return this.size | 0; }
  label(): number | undefined { return this.size / 0 - this.size / 0; }
  scaled(factor: number): number { return factor - this.size; }
}
class Point extends Shape {
  area(): number { return this.size - this.size; }
  corners(): number { return 1; }
  label(): number | undefined { return 4294967296 + this.size; }
  scaled(factor: number): number { return 2147483647 + factor; }
}

function areaOf(shape: Shape): number { return shape.area() + 1; }
function cornersOf(shape: Shape): number { return shape.corners() ^ 1; }
function labelOf(shape: Shape): number | undefined { return shape.label(); }
function labelOr(shape: Shape, other: number): number { return shape.label() ?? other; }
function scaledBy(shape: Shape, factor: number): number { return shape.scaled(factor) * 2; }
function total(shapes: Shape[]): number {
  let sum = 0;
  for (const shape of shapes) sum += shape.area() + shape.corners();
  return sum;
}

const shapes: Shape[] = [new Square(seed), new Disc(seed), new Triangle(seed), new Line(seed), new Ring(seed + 0.5), new Point(seed), new Square(seed + 2)];
function round(name: string): void {
  for (const shape of shapes) {
    show(name + " area", areaOf(shape));
    show(name + " corners", cornersOf(shape));
    show(name + " label", labelOf(shape));
    show(name + " label or", labelOr(shape, -1));
    show(name + " scaled", scaledBy(shape, 1.5));
  }
  show(name + " total", total(shapes));
}
round("as defined");

// One object hides two methods.
shapes[1]!.area = function (this: Shape): number { return this.size + 0.125; };
shapes[1]!.corners = (): number => 9;
round("hidden on an object");

// A prototype gets other methods.
Triangle.prototype.area = function (this: Triangle): number { return -this.size; };
Line.prototype.label = function (): number | undefined { return 12; };
Ring.prototype.scaled = function (this: Ring, factor: number): number { return factor; };
round("replaced on prototypes");

delete (shapes[1] as { area?: unknown }).area;
round("shown again");
console.log(out.join("\n"));
