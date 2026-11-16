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
const numbers: number[] = JSON.parse("[" + Array.from({ length: 60 }, (_, k) => (k * 7919) % 101).join() + "]");
function make(n: number): Shape {
  switch (n & 3) {
    case 0: return new Square(n % 100);
    case 1: return new Rectangle(n % 100, n % 50);
    case 2: return new Circle(n % 30);
    default: return new Triangle((n % 40) * 2, n % 20);
  }
}
function attempt(name: string, run: () => number): void {
  for (let round = 0; round < 3; round++) {
    try { out.push(name + " " + show(run())); } catch (error) { out.push(name + " threw " + show(error)); }
  }
}

const plain: Shape[] = numbers.map(make);
attempt("of", () => { let total = 0; for (const shape of plain) { total += shape.area(); shape.scale(3); } return total; });
attempt("index", () => { let total = 0; for (let k = 0; k < plain.length; k++) { total += plain[k].area(); plain[k].scale(2); } return total; });
attempt("area", () => { let total = 0; for (let k = 0; k < plain.length; k++) total += plain[k].area(); return total; });
attempt("bits", () => { let total = 0; for (const shape of plain) total = (total + shape.area()) & 0xffffff; return total; });
attempt("writes", () => { let total = 0; for (let k = 0; k < plain.length; k++) { const shape = plain[k]; shape.scale(k); total += shape.area() * 2 + shape.area(); } return total; });

const named: Shape[] = numbers.map(make);
for (let k = 0; k < named.length; k += 7) (named[k] as any).extra = k;
attempt("a name of its own", () => { let total = 0; for (const shape of named) { total += shape.area(); shape.scale(3); } return total; });

const own: Shape[] = numbers.map(make);
for (let k = 3; k < own.length; k += 11) Object.assign(own[k], { area() { return 11; } });
attempt("a method of its own", () => { let total = 0; for (const shape of own) { total += shape.area(); shape.scale(3); } return total; });

const others: Shape[] = numbers.map(make);
for (let k = 5; k < others.length; k += 13) Object.setPrototypeOf(others[k], { area() { return 5; }, scale() {} });
attempt("another prototype", () => { let total = 0; for (const shape of others) { total += shape.area(); shape.scale(3); } return total; });

const getters: Shape[] = numbers.map(make);
let asked = 0;
for (let k = 4; k < getters.length; k += 9) Object.defineProperty(getters[k], "side", { get() { asked++; return 9; }, set() { asked += 100; } });
attempt("an accessor in place of a field", () => { let total = 0; for (const shape of getters) { total += shape.area(); shape.scale(3); } return total + asked; });

const frozen: Shape[] = numbers.map(make);
for (let k = 1; k < frozen.length; k += 8) Object.freeze(frozen[k]);
attempt("frozen", () => { let total = 0; for (const shape of frozen) { total += shape.area(); try { shape.scale(3); } catch (error) { total += show(error).length > 5 ? 1 : 0; } } return total; });

const texts: Shape[] = numbers.map(make);
(texts[20] as any).side = "6"; (texts[21] as any).width = null; (texts[22] as any).radius = 2 ** 40;
attempt("other values in fields", () => { let total: any = 0; for (const shape of texts) { total += shape.area(); shape.scale(3); } return total; });

const holes: Shape[] = numbers.map(make);
delete holes[33];
attempt("a hole", () => { let total = 0; for (let k = 0; k < holes.length; k++) { try { total += holes[k].area(); holes[k].scale(2); } catch { total -= 1; } } return total; });
attempt("a hole that throws", () => { let total = 0; for (let k = 0; k < holes.length; k++) { total += holes[k].area(); holes[k].scale(2); } return total; });

const changed: Shape[] = numbers.map(make);
attempt("changed in the middle", () => {
  let total = 0;
  for (let k = 0; k < changed.length; k++) { total += changed[k].area(); if (k === 40) changed[45] = new Square(1000); if (k === 50) changed.length = 57; changed[k].scale(7); }
  return total;
});

const literals: Shape[] = numbers.map(make);
literals.push({ area: () => 7, scale() {} }, new Proxy(new Square(4), {}), new (class extends Square { area() { return super.area() + 1; } })(3));
attempt("literals", () => { let total = 0; for (const shape of literals) { total += shape.area(); shape.scale(3); } return total; });

const empty: Shape[] = numbers.map(make);
empty[30] = Object.create(Circle.prototype);
attempt("an empty object of the class", () => { let total = 0; for (const shape of empty) { const area = shape.area(); total += area === area ? area : 1; shape.scale(3); } return total; });

const before: Shape[] = numbers.map(make);
let seen = 0;
attempt("counts in front", () => { let total = 0; for (const shape of before) { seen++; total += shape.area(); shape.scale(seen); } return total + seen; });

const replaced: Shape[] = numbers.map(make);
const area = Square.prototype.area, scale = Circle.prototype.scale;
attempt("a method replaced", () => { let total = 0; for (let k = 0; k < replaced.length; k++) { const shape = replaced[k]; total += shape.area(); if (k === 20) Square.prototype.area = () => 1000; shape.scale(3); } Square.prototype.area = area; return total; });
attempt("a method gone", () => { let total = 0; try { for (let k = 0; k < replaced.length; k++) { const shape = replaced[k]; total += shape.area(); if (k === 20) delete (Circle.prototype as any).scale; shape.scale(3); } } catch { total += 0.25; } Circle.prototype.scale = scale; return total; });
console.log(out.join("\n"));
