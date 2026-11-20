// The receiver is found in front of the loop.
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

const all = hidden<Shape[]>([new Square(2), undefined, null, new Disk(1)]);
for (let round = 0; round < 3; round++) console.log(all.map(each => attempt(() => sum(each, 4)) + "," + attempt(() => both(each, 3))).join(" "));
