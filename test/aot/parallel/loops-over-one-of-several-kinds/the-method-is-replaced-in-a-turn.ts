// On the class, and on the object.
const show = (value: any): string => {
  try {
    return Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "string" ? JSON.stringify(value) : typeof value === "function" ? "function" : String(value);
  } catch (error) {
    return "cannot be shown";
  }
};
const attempt = (run: () => unknown): string => {
  try {
    return show(run());
  } catch (error) {
    return (error as Error).constructor.name;
  }
};
// Nobody can follow a value through a property of the global object.
function hidden<T>(value: unknown): T {
  (globalThis as any).handedOn = value;
  return (globalThis as any).handedOn as T;
}
abstract class Shape { abstract area(): number; twice(): number { return this.area() * 2; } }
class Square extends Shape { constructor(public side: number) { super(); } area(): number { return this.side * this.side; } }
class Rect extends Shape { constructor(public w: number, public h: number) { super(); } area(): number { return this.w * this.h; } }
class Disk extends Shape { constructor(public r: number) { super(); } area(): number { return 3 * this.r * this.r; } twice(): number { return super.twice() + 1; } }
function sum(shape: Shape, turns: number): unknown { let total: any = 0; for (let i = 0; i < turns; i++) total += shape.area(); return total; }
function both(shape: Shape, turns: number): unknown { let total: any = 0; for (let i = 0; i < turns; i++) total += shape.twice() - shape.area(); return total; }

function sumAndChange(shape: Shape, turns: number, change: (i: number) => void): unknown { let total: any = 0; for (let i = 0; i < turns; i++) { change(i); total += shape.area(); } return total; }
const square = hidden<Shape>(new Square(2)), rect = hidden<Shape>(new Rect(2, 3));
console.log(sumAndChange(square, 4, () => {}), sumAndChange(rect, 4, () => {}));
console.log(sumAndChange(square, 4, i => { if (i === 2) (square as any).area = () => 100; }));
console.log(sumAndChange(rect, 4, i => { if (i === 2) Rect.prototype.area = function () { return -1; }; }));
console.log(sumAndChange(square, 4, () => {}), sumAndChange(rect, 4, () => {}), sum(new Rect(1, 1), 2));
