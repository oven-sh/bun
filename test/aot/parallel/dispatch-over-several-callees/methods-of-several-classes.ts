const out: string[] = [];
const show = (v: unknown): string => Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : v instanceof Error ? v.name + " " + v.message : typeof v === "object" && v ? "object" : String(v);
interface Shape { area(): number; scale(by: number): void }
class Square implements Shape {
  constructor(private side: number) {}
  area() { return this.side * this.side; }
  scale(by: number) { this.side = (this.side * by) % 1000; }
}
class Rectangle implements Shape {
  constructor(private width: number, private height: number) {}
  area() { return this.width * this.height; }
  scale(by: number) { this.width = (this.width * by) % 1000; }
}
class Circle implements Shape {
  constructor(private radius: number) {}
  area() { return this.radius * this.radius * 3; }
  scale(by: number) { this.radius = (this.radius * by) % 1000; }
}
class Triangle implements Shape {
  constructor(private base: number, private height: number) {}
  area() { return (this.base * this.height) / 2; }
  scale(by: number) { this.height = (this.height * by) % 1000; }
}
let count = 0;
const log: string[] = [];
const numbers: number[] = JSON.parse("[" + Array.from({ length: 60 }, (_, k) => (k * 7919) % 101).join() + "]");
function make(): Shape[] {
  return numbers.map((n): Shape => {
    switch (n & 3) {
      case 0: return new Square(n % 100);
      case 1: return new Rectangle(n % 100, n % 50);
      case 2: return new Circle(n % 30);
      default: return new Triangle((n % 40) * 2, n % 20);
    }
  });
}
const strange: [string, (list: any[]) => void][] = [
  ["nothing", () => {}],
  ["null", list => { list[31] = null; }],
  ["undefined", list => { list[31] = undefined; }],
  ["a literal", list => { list[31] = { area: () => 7, scale() {} }; }],
  ["a getter", list => { list[31] = { get area() { log.push("getter"); return () => 3; }, scale() {} }; }],
  ["a proxy", list => { list[31] = new Proxy(new Square(4), {}); }],
  ["frozen", list => { list[31] = Object.freeze(new Square(4)); }],
  ["another prototype", list => { list[31] = Object.setPrototypeOf(new Square(4), { area() { return 5; }, scale() {} }); }],
  ["an own method", list => { list[31] = Object.assign(new Circle(4), { area() { return 11; } }); }],
  ["an own name", list => { list[31] = Object.assign(new Rectangle(4, 5), { extra: 1 }); }],
  ["a class below", list => { list[31] = new (class extends Square { area() { return super.area() + 1; } })(3); }],
  ["an empty object of the class", list => { list[31] = Object.create(Square.prototype); }],
  ["a string in a field", list => { list[31] = new Square("6" as any); }],
  ["undefined in a field", list => { list[31] = new Circle(undefined as any); }],
  ["a bigint in a field", list => { list[31] = new Rectangle(3n as any, 4n as any); }],
  ["an accessor in place of a field", list => { list[31] = Object.defineProperty(new Square(3), "side", { get() { log.push("side"); return 9; } }); }],
  ["a number", list => { list[31] = 5; }],
  ["a hole", list => { delete list[31]; }],
  ["a method that throws", list => { list[31] = Object.assign(new Square(2), { scale() { throw new RangeError("scale"); } }); }],
  ["a string from a method", list => { list[31] = Object.assign(new Square(2), { area: () => "s" }); }],
];
const loops: [string, (list: Shape[]) => number][] = [
  ["of", list => { let total = 0; for (const shape of list) { total += shape.area(); shape.scale(3); } return total; }],
  ["index", list => { let total = 0; for (let k = 0; k < list.length; k++) { count++; total += list[k].area(); list[k].scale(2); } return total; }],
  ["area", list => { let total = 0; for (let k = 0; k < list.length; k++) total += list[k].area(); return total; }],
  ["bits", list => { let total = 0; for (const shape of list) total = (total + shape.area()) & 0xffffff; return total; }],
  ["writes", list => { let total = 0; for (let k = 0; k < list.length; k++) { const shape = list[k]; shape.scale(k); count++; total += shape.area() * 2 + shape.area(); } return total; }],
  ["push", list => { const areas: number[] = []; for (const shape of list) { areas.push(shape.area()); shape.scale(areas.length); } return areas.length + areas.reduce((a, b) => a + b, 0); }],
  ["tries", list => { let total = 0; for (const shape of list) { try { shape.scale(5); total += shape.area(); } catch (error) { log.push(show(error)); total -= 1; } } return total; }],
  ["changes", list => { let total = 0; for (let k = 0; k < list.length; k++) { total += list[k].area(); if (k === 40) (list as any)[45] = { area: () => 0.5, scale() {} }; if (k === 50) list.length = 55; list[k].scale(7); } return total; }],
];
for (const [form, loop] of loops) {
  for (const [name, spoil] of strange) {
    const list = make(); spoil(list); count = 0; log.length = 0;
    let line = form + " | " + name + " | ";
    for (let round = 0; round < 2; round++) {
      try { line += show(loop(list)) + " "; } catch (error) { line += "threw " + show(error) + " "; }
    }
    out.push(line + count + " " + log.join());
  }
}
function replaced(name: string, change: () => void, back: () => void): void {
  const list = make(); let line = "replaced | " + name + " | ";
  try {
    let total = 0;
    for (let k = 0; k < list.length; k++) { const shape = list[k]; total += shape.area(); if (k === 20) change(); shape.scale(3); }
    line += show(total);
  } catch (error) { line += "threw " + show(error); }
  back();
  out.push(line);
}
const area = Square.prototype.area, scale = Circle.prototype.scale;
replaced("area", () => { Square.prototype.area = () => 1000; }, () => { Square.prototype.area = area; });
replaced("area by a string", () => { (Square.prototype as any).area = () => "a"; }, () => { Square.prototype.area = area; });
replaced("scale is gone", () => { delete (Circle.prototype as any).scale; }, () => { Circle.prototype.scale = scale; });
replaced("area is a getter", () => { Object.defineProperty(Square.prototype, "area", { get() { return () => 2; }, configurable: true }); }, () => { Object.defineProperty(Square.prototype, "area", { value: area, configurable: true, writable: true }); });
console.log(out.join("\n"));
