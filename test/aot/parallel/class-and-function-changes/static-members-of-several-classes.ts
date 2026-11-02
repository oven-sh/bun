const opaque = (value: any): any => new CustomEvent("opaque", { detail: value }).detail; // the compiler can't see through a value returned by native code
function show(value: unknown): string {
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return Object.prototype.toString.call(value);
  return typeof value + " " + String(value);
}
function attempt(label: string, action: () => unknown): void {
  let outcome: string;
  try {
    outcome = show(action());
  } catch (error) {
    outcome = (error as Error).name;
  }
  console.log(label + ": " + outcome);
}
class Shape {
  static sides = 0;
  static label = "shape";
  static describe(): string {
    return this.label + " with " + this.sides;
  }
}
class Square extends Shape {
  static override sides = 4;
  static override label = "square";
}
class Plain extends Shape {}
function sidesOf(kind: typeof Shape): unknown {
  return kind.sides;
}
function labelOf(kind: typeof Shape): unknown {
  return kind.label;
}
function describe(kind: typeof Shape): unknown {
  return kind.describe();
}
function setSides(kind: typeof Shape, sides: number): void {
  kind.sides = sides;
}
function nameOf(kind: typeof Shape): unknown {
  return kind.name;
}
function make(kind: typeof Shape): unknown {
  return new kind() instanceof Shape;
}
const kinds: [string, typeof Shape][] = [
  ["Shape", Shape],
  ["Square", Square],
  ["Plain", Plain],
];
function showAll(when: string): void {
  for (const [name, kind] of kinds)
    attempt(when + ", " + name, () =>
      [sidesOf(kind), labelOf(kind), describe(kind), nameOf(kind), make(kind)].join(" | "),
    );
}
showAll("as declared");
showAll("as declared, again");
setSides(Shape, 1);
showAll("Shape.sides assigned");
setSides(Plain, 2);
showAll("Plain.sides assigned");
(Square as any).sides = "four";
showAll("Square.sides is a string");
delete (Square as any).label;
showAll("Square.label deleted");
Object.defineProperty(Shape, "label", {
  get() {
    return "computed";
  },
  configurable: true,
});
showAll("Shape.label is a getter");
(Shape as any).describe = function () {
  return "replaced";
};
showAll("Shape.describe replaced");
Object.setPrototypeOf(Plain, Square);
showAll("Plain inherits from Square");
Object.defineProperty(Square, "name", { value: "Renamed" });
showAll("Square renamed");
kinds.push([
  "an object",
  {
    sides: 9,
    label: "object",
    describe() {
      return "from an object";
    },
    name: "not a class",
  } as any,
]);
kinds.push([
  "a function",
  Object.assign(function () {}, {
    sides: 8,
    label: "function",
    describe() {
      return "from a function";
    },
  }) as any,
]);
kinds.push(["null", null as any]);
showAll("values that aren't classes");
export {};
