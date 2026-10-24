function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

(globalThis as any).note = (text: string) => log.push(text);
const hidden = (text: string): any => (0, eval)("(" + text + ")");

class Circle {
  radius: number;
  constructor(radius: number) {
    this.radius = radius;
  }
  area(): number {
    return this.radius * this.radius * 3;
  }
  describe(): string {
    return "circle of " + this.area();
  }
  get diameter(): number {
    return this.radius * 2;
  }
  static unit(): Circle {
    return new this(1);
  }
  static count = 0;
}

class Ring extends Circle {
  hole: number;
  constructor(radius: number, hole: number) {
    super(radius);
    this.hole = hole;
  }
  area(): number {
    return super.area() - this.hole * this.hole * 3;
  }
}

function areaOf(c: Circle): number {
  return c.area();
}

function describe(c: Circle): string {
  return c.describe();
}

function diameterOf(c: Circle): number {
  return c.diameter + 1;
}

function honest(label: string): void {
  console.log(label, areaOf(new Circle(1)), areaOf(new Ring(2, 1)), describe(new Circle(2)), describe(new Ring(2, 1)), diameterOf(new Circle(3)), Circle.unit().radius, Ring.unit().radius);
}

honest("honest before");
let warm = 0;
for (let i = 0; i < 2000; i++) warm += areaOf(new Circle(i)) + areaOf(new Ring(i, 1)) + describe(new Circle(1)).length + diameterOf(new Circle(i));
console.log("2000 honest rounds", warm);

const subclass = (text: string): any => hidden(text)(Circle, Ring);

attempt("an unseen subclass overrides area", () => {
  const Odd = subclass("(Circle => class Odd extends Circle { area() { return 'odd area'; } })");
  const c: Circle = new Odd(1);
  return [areaOf(c), describe(c), c instanceof Circle, diameterOf(c)];
});
attempt("an unseen subclass overrides the getter", () => {
  const Odd = subclass("(Circle => class Odd extends Circle { get diameter() { return 'wide'; } })");
  return diameterOf(new Odd(1));
});
attempt("an unseen subclass turns the field into an accessor", () => {
  const Odd = subclass("(Circle => class Odd extends Circle { get radius() { note('get-radius'); return 10; } set radius(v) { note('set-radius:' + v); } })");
  const c: Circle = new Odd(1);
  return [areaOf(c), Object.keys(c)];
});
attempt("an unseen subclass of the subclass", () => {
  const Odd = subclass("((Circle, Ring) => class Odd extends Ring { area() { return super.area() + 0.5; } })");
  return [areaOf(new Odd(2, 1)), describe(new Odd(2, 1))];
});
attempt("an unseen subclass returns something else from its constructor", () => {
  const Odd = subclass("(Circle => class Odd extends Circle { constructor() { super(1); return { radius: 'r', area() { return 'returned'; } }; } })");
  const c: Circle = new Odd();
  return [areaOf(c), c instanceof Circle];
});
attempt("the static factory on an unseen subclass", () => {
  const Odd = subclass("(Circle => class Odd extends Circle { area() { return -1; } })");
  const c: Circle = Odd.unit();
  return [areaOf(c), c.constructor.name];
});
attempt("an ES5 subclass", () => {
  const Odd = subclass("(Circle => { function Odd() { this.radius = 2; } Odd.prototype = Object.create(Circle.prototype); Odd.prototype.area = function () { return 'es5'; }; return Odd; })");
  const c: Circle = new Odd();
  return [areaOf(c), describe(c), c instanceof Circle];
});

attempt("an own member shadows the method", () => {
  const c = new Circle(1);
  (c as any).area = () => "own";
  return [areaOf(c), describe(c)];
});
attempt("the method is replaced on the prototype", () => {
  const original = Circle.prototype.area;
  (Circle.prototype as any).area = function () {
    return "patched " + this.radius;
  };
  try {
    return [areaOf(new Circle(1)), describe(new Circle(1)), areaOf(new Ring(2, 1))];
  } finally {
    Circle.prototype.area = original;
  }
});
attempt("and put back", () => [areaOf(new Circle(1)), areaOf(new Ring(2, 1))]);
attempt("the method is deleted from the subclass", () => {
  const original = Ring.prototype.area;
  delete (Ring.prototype as any).area;
  try {
    return areaOf(new Ring(2, 1));
  } finally {
    Ring.prototype.area = original;
  }
});
attempt("the getter is redefined", () => {
  const original = Object.getOwnPropertyDescriptor(Circle.prototype, "diameter")!;
  Object.defineProperty(Circle.prototype, "diameter", { get: () => "redefined", configurable: true });
  try {
    return diameterOf(new Circle(1));
  } finally {
    Object.defineProperty(Circle.prototype, "diameter", original);
  }
});
attempt("the parent of the subclass's prototype is swapped", () => {
  Object.setPrototypeOf(Ring.prototype, { area: () => 1000, describe: () => "other parent" });
  try {
    return [areaOf(new Ring(2, 1)), describe(new Ring(2, 1)), new Ring(2, 1) instanceof Circle];
  } finally {
    Object.setPrototypeOf(Ring.prototype, Circle.prototype);
  }
});
attempt("the parent constructor of the subclass is swapped", () => {
  Object.setPrototypeOf(Ring, hidden("(class Other { constructor(r) { this.radius = 'other ' + r; } })"));
  try {
    const r = new Ring(2, 1);
    return [r.radius, Object.keys(r), areaOf(r)];
  } finally {
    Object.setPrototypeOf(Ring, Circle);
  }
});
attempt("the static method is replaced", () => {
  const original = Circle.unit;
  (Circle as any).unit = () => "no circle";
  try {
    return Circle.unit();
  } finally {
    Circle.unit = original;
  }
});
attempt("one instance gets another prototype", () => {
  const c = new Circle(2);
  Object.setPrototypeOf(c, Ring.prototype);
  return [areaOf(c), c instanceof Ring];
});
attempt("Symbol.hasInstance is defined later", () => {
  Object.defineProperty(Circle, Symbol.hasInstance, { value: () => true, configurable: true });
  try {
    const v: unknown = hidden("5");
    return v instanceof Circle ? typeof v.radius : "no";
  } finally {
    delete (Circle as any)[Symbol.hasInstance];
  }
});

honest("honest after");
