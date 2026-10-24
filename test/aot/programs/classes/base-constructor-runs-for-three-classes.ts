// A base class whose constructor runs for two classes.
class Shape {
  sides: number;
  name: string;
  constructor(sides: number, name: string) {
    this.sides = sides;
    this.name = name;
  }
}
class Square extends Shape {
  edge: number;
  constructor(edge: number) {
    super(4, "square");
    this.edge = edge;
  }
}
class Triangle extends Shape {
  base: number;
  constructor(base: number) {
    super(3, "triangle");
    this.base = base;
  }
}
function disturb(o: any, name: string, how: number): void {
  if (how === 1) delete o[name];
  else if (how === 2) Object.defineProperty(o, name, { get() { return 1; }, configurable: true });
  else if (how === 3) o[name] = how;
  else if (how === 4) Object.setPrototypeOf(o, null);
  else if (how === 5) Object.freeze(o);
}
const names = ["sides", "name", "edge", "base", "sides"];
const pool: any[] = [];
let total = 0;
for (let round = 0; round < 30000; round++) {
  const which = round % 3;
  const made = which === 0 ? new Shape(round & 7, "shape") : which === 1 ? new Square(round & 15) : new Triangle(round & 31);
  total += made.sides + made.name.length;
  if ((round & 1023) === 0) pool.push(made);
}
const spare: any = { sides: 1, name: 2, edge: 3, base: 4 };
pool.push(spare);
for (let how = 1; how <= 5; how++) disturb(pool[pool.length - 1], names[how - 1], how);
console.log(total, pool.length);
