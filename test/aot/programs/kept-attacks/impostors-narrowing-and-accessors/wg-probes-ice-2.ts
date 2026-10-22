// Impostors narrowing and accessors: wg probes ice. It prints what plain Bun prints.
function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(text).join(", ") + "]";
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Shape {
  sides = 4;
  isSquare(): this is Square {
    return this instanceof Square;
  }
}

class Square extends Shape {
  edge = 2;
}

class Circle extends Shape {
  radius = 5;
}

class Holder {
  shape: Shape = new Square();
  value: number | string = 1;
  holdsANumber(): this is Holder & { value: number } {
    return typeof this.value === "number";
  }
}

function isSquare(s: Shape): s is Square {
  return s instanceof Square;
}

function isNumber(v: number | string): v is number {
  return typeof v === "number";
}

function mustBeSquare(s: Shape): asserts s is Square {
  if (!(s instanceof Square)) throw new RangeError("not a square");
}

function mustBeNumber(v: number | string): asserts v is number {
  if (typeof v !== "number") throw new RangeError("not a number");
}

function mustHold(condition: boolean): asserts condition {
  if (!condition) throw new RangeError("does not hold");
}

type Between = (h: Holder) => void;
const keep: Between = () => {};
const toBase: Between = h => {
  h.shape = new Shape();
  h.value = "text";
};
const toSibling: Between = h => {
  h.shape = new Circle();
  h.value = "";
};

const uses: [string, (h: Holder, between: Between) => unknown][] = [
  ["a guard over a number", (h, between) => (isNumber(h.value) ? (between(h), [h.value, h.value + 1, h.value * 2]) : "other")],
];

function round(label: string, between: Between): void {
  for (const [name, use] of uses) attempt(label + ": " + name, () => use(new Holder(), between));
}

round("honest", keep);
for (let i = 0; i < 2000; i++) for (const [, use] of uses) use(new Holder(), keep);
round("the base class and a string", toBase);
round("a sibling and an empty string", toSibling);
round("honest again", keep);
