// Object literals with spreads, in front of, between and behind named fields. What is spread has the declared fields, others, fewer, getters, hidden and symbol properties, index keys, an own `__proto__`, or is no object at all.
interface Point {
  x: number;
  y: number;
  label?: string;
}

const trail: string[] = [];
const mark = Symbol("mark");

function show(value: object): string {
  return JSON.stringify(value) + " [" + Reflect.ownKeys(value).map(String).join() + "] " + (Object.getPrototypeOf(value) === Object.prototype);
}
function attempt(run: () => object): string {
  try {
    return show(run());
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}

function withDefaults(point: Partial<Point>): Point {
  return { x: 0, y: 0, ...point };
}
function overridden(point: Point): Point {
  return { ...point, x: -1 };
}
function between(point: Point): object {
  return { before: "b", ...point, after: "a" };
}
function twice(point: Point): object {
  const again: Partial<Point> = point;
  return { ...point, y: 5, ...again };
}
function alone(point: Point): Point {
  return { ...point };
}
function nested(point: Point): object {
  return { outer: { ...point, inner: { ...point } }, list: [{ ...point }] };
}
function look(name: string, make: () => unknown): void {
  console.log(name + ":");
  console.log("  defaults:", attempt(() => withDefaults(make() as Point)), trail.splice(0).join(";"));
  console.log("  overridden:", attempt(() => overridden(make() as Point)), trail.splice(0).join(";"));
  console.log("  between:", attempt(() => between(make() as Point)), trail.splice(0).join(";"));
  console.log("  twice:", attempt(() => twice(make() as Point)), trail.splice(0).join(";"));
  console.log("  alone:", attempt(() => alone(make() as Point)), trail.splice(0).join(";"));
  console.log("  nested:", attempt(() => nested(make() as Point)), trail.splice(0).join(";"));
}

class PointClass {
  y = 2;
  x = 1;
  norm(): number {
    return this.x + this.y;
  }
  get computed(): number {
    return 3;
  }
}

look("expected", (): Point => ({ x: 1, y: 2 }));
look("expected with the optional field", (): Point => ({ x: 1, y: 2, label: "l" }));
look("class instance", () => new PointClass());
look("reordered and more", () => ({ z: 3, y: 2, label: undefined, x: 1 }));
look("fewer", () => ({ y: 2 }));
look("empty", () => ({}));
look("other kinds of values", () => ({ x: "x", y: null }));
look("getters", () => ({
  get x() {
    trail.push("get x");
    return 10;
  },
  get y() {
    trail.push("get y");
    return 20;
  },
}));
look("a getter that throws", () => ({
  x: 1,
  get y(): number {
    throw new RangeError("y");
  },
}));
look("a getter that deletes what follows", () => ({
  get x() {
    delete (this as any).y;
    return 1;
  },
  y: 2,
}));
look("hidden and symbol properties", () => Object.defineProperty({ x: 1, [mark]: "m", y: 2 }, "x", { enumerable: false }));
look("index keys", () => ({ x: 1, 2: "two", y: 2, 0: "zero" }));
look("an own __proto__", () => JSON.parse('{"x":1,"__proto__":{"y":"inherited?"}}'));
look("inherited fields", () => Object.create({ x: 1, y: 2 }));
look("parsed", () => JSON.parse('{"label":"p","y":2,"x":1}'));
look("array", () => [7, 8]);
look("text", () => "ab");
look("number", () => 5);
look("null", () => null);
look("undefined", () => undefined);
look("proxy", () =>
  new Proxy(
    { x: 1, y: 2 },
    {
      ownKeys(target) {
        trail.push("keys");
        return Reflect.ownKeys(target).reverse();
      },
      getOwnPropertyDescriptor(target, key) {
        trail.push("describe " + String(key));
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
      get(target, key) {
        trail.push("get " + String(key));
        return Reflect.get(target, key);
      },
    },
  ),
);
look("expected", (): Point => ({ x: 1, y: 2 }));

export {};
