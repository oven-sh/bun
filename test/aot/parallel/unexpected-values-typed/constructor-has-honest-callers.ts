// A constructor has honest callers and one from any.
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

class Vector {
  x: number;
  y: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  plus(other: Vector): Vector {
    return new Vector(this.x + other.x, this.y + other.y);
  }

  text(): string {
    return JSON.stringify(this) + Object.keys(this).join();
  }
}

class Label {
  constructor(
    public text: string,
    public tags: string[] = [],
    readonly weight: number = 1,
  ) {}

  width(): number {
    return this.text.length * this.weight + this.tags.length;
  }
}

class Wrapper {
  inner: Vector;
  constructor(inner: Vector) {
    this.inner = inner;
  }
  reach(): number {
    return this.inner.x + this.inner.length();
  }
}

function honest(label: string): void {
  const a = new Vector(3, 4);
  const b = new Vector(0.5, -0);
  console.log(label, a.length(), a.plus(b).text(), new Label("abc").width(), new Label("ab", ["t"], 2).width(), new Wrapper(a).reach());
}

const values = [
  "3",
  "'3'",
  "-0",
  "NaN",
  "3n",
  "null",
  "undefined",
  "true",
  "[3]",
  "{}",
  "{ valueOf() { note('valueOf'); return 3; } }",
  "Symbol()",
];

honest("honest before");
let warm = 0;
for (let i = 0; i < 2000; i++) warm += new Vector(i, 0).length() + new Label("a").width() + new Wrapper(new Vector(i, 0)).reach();
console.log("2000 honest constructions", warm);

for (const text of values) {
  let made: Vector | undefined;
  attempt("new Vector(" + text + ", 4)", () => {
    made = new Vector(hidden(text), 4);
    return typeof made.x;
  });
  if (made === undefined) continue;
  const vector: Vector = made;
  attempt("  x", () => vector.x);
  attempt("  x + 1", () => vector.x + 1);
  attempt("  length", () => vector.length());
  attempt("  plus honest", () => vector.plus(new Vector(1, 1)).x);
  attempt("  honest plus it", () => new Vector(1, 1).plus(vector).x);
  attempt("  text", () => vector.text());
  attempt("  wrapped", () => new Wrapper(vector).reach());
}

for (const text of ["'abc'", "5", "null", "undefined", "['a', 'b']", "new String('abc')", "{ length: 4 }"]) {
  attempt("new Label(" + text + ").width()", () => new Label(hidden(text)).width());
  attempt("new Label('a', " + text + ").width()", () => new Label("a", hidden(text)).width());
  attempt("new Label('a', [], " + text + ").width()", () => new Label("a", [], hidden(text)).width());
}

for (const text of ["{ x: 1, y: 2 }", "{ x: 1, y: 2, length() { return 'own'; } }", "{ x: '1', length: Math.sqrt }", "null", "5", "Object.create({ x: 1, length() { return this.x; } })"]) {
  attempt("new Wrapper(" + text + ").reach()", () => new Wrapper(hidden(text)).reach());
  attempt("honest.plus(" + text + ")", () => new Vector(1, 1).plus(hidden(text)).text());
}

const AnyVector: any = Vector;
attempt("no arguments", () => new AnyVector().text());
attempt("one argument", () => new AnyVector(1).text());
attempt("three arguments", () => new AnyVector(1, 2, 3).text());
attempt("called without new", () => AnyVector(1, 2));
attempt("Reflect.construct", () => Reflect.construct(Vector, hidden("['1', 2]")).text());
attempt("Reflect.construct with another new.target", () => {
  const made = Reflect.construct(Vector, [1, 2], hidden("(class Other { length() { return 'other'; } })"));
  return made.length() + "/" + (made instanceof Vector) + "/" + Object.keys(made).join();
});
attempt("spread of a string", () => new AnyVector(...hidden("'12'")).text());

honest("honest after");
