// Instances of subclasses arrive where reads, stores and method calls expect the base class: with more fields, with the field declared again, with an accessor or a method under the field's name.
const stores: string[] = [];

class Shape {
  name = "shape";
  sides = 0;
  area(): number {
    return this.sides;
  }
  describe(): string {
    return this.name + " " + this.sides + " " + this.area();
  }
}
class Square extends Shape {
  edge = 2;
  name = "square";
  sides = 4;
  area(): number {
    return this.edge * this.edge;
  }
}
class Tall extends Square {
  height = 3;
  area(): number {
    return super.area() * this.height;
  }
}
class Quiet extends Shape {}
class Computed extends Shape {
  constructor() {
    super();
    delete (this as any).sides;
    delete (this as any).name;
  }
}
Object.defineProperty(Computed.prototype, "sides", {
  get() {
    return 99;
  },
  set(value: number) {
    stores.push("sides=" + value);
  },
  configurable: true,
});
Object.defineProperty(Computed.prototype, "name", {
  get() {
    return "computed";
  },
  configurable: true,
});
class EarlyReader extends Shape {
  seen: string;
  late = "late";
  constructor() {
    super();
    this.seen = nameOf(this) + "/" + sidesOf(this);
  }
}
class FromFunction extends (function (this: any) {
  this.name = "from a function";
  this.sides = -1;
} as unknown as new () => { name: string; sides: number }) {
  area(): number {
    return 0.5;
  }
  describe(): string {
    return "described below a function";
  }
}

function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}
function nameOf(shape: Shape): string {
  return shape.name;
}
function sidesOf(shape: Shape): number {
  return shape.sides;
}
function setSides(shape: Shape, sides: number): void {
  shape.sides = sides;
}
function areaOf(shape: Shape): number {
  return shape.area();
}
function describe(shape: Shape): string {
  return shape.describe();
}
function look(mark: string, shape: Shape): void {
  const before = [attempt(() => nameOf(shape)), attempt(() => sidesOf(shape)), attempt(() => areaOf(shape)), "[" + attempt(() => describe(shape)) + "]"].join(" ");
  const stored = attempt(() => setSides(shape, sidesOf(shape) + 1));
  console.log(mark + ":", before, stored, "->", attempt(() => sidesOf(shape)), attempt(() => areaOf(shape)), Object.keys(shape).join(), shape instanceof Shape, stores.splice(0).join());
}

look("base", new Shape());
look("square", new Square());
look("base", new Shape());
look("tall", new Tall());
look("square", new Square());
look("quiet", new Quiet());
look("computed", new Computed());
look("computed", new Computed());
look("early reader", new EarlyReader());
console.log(new EarlyReader().seen);
look("below a function", new FromFunction());
look("tall", new Tall());
look("base", new Shape());

const borrowed = Object.create(new Square());
look("below an instance", borrowed);
look("below an instance, after the store", borrowed);

const constructedFor = Reflect.construct(Shape, [], Tall);
look("the base constructed for a subclass", constructedFor);
const constructedForFunction = Reflect.construct(Square, [], function () {});
look("a subclass constructed for a function", constructedForFunction);

export {};
