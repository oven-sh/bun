function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

class Point {
  x: number;
  y: number;
  label = "point";
  visible = true;
  tags: string[] = ["first"];
  origin: { id: number } = { id: 7 };
  note?: string;
  #secret = 42;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  norm(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }
  get sum(): number {
    return this.x + this.y;
  }
  set sum(value: number) {
    this.x = value;
    this.y = 0;
  }
  secret(): number {
    return this.#secret;
  }
  static isPoint(value: object): boolean {
    return #secret in value;
  }
}

function dressed(source: Point): Point {
  return Object.setPrototypeOf({ y: source.y, extra: "more", x: source.x, label: source.label }, Point.prototype);
}

const uses: [string, (p: Point) => unknown][] = [
  ["typeof", p => typeof p],
  ["x + 1", p => p.x + 1],
  ["y * 2", p => p.y * 2],
  ["x | 0", p => p.x | 0],
  ["length of the label", p => p.label.length],
  ["the label and a mark", p => p.label + "!"],
  ["visible", p => (p.visible ? "yes" : "no")],
  ["exactly true", p => p.visible === true],
  ["tags", p => [p.tags.length, p.tags[0]]],
  ["id of the origin", p => p.origin.id],
  ["note", p => p.note ?? "no note"],
  ["norm()", p => p.norm()],
  ["typeof norm", p => typeof p.norm],
  ["the prototype's norm", p => p.norm === Point.prototype.norm],
  ["the getter", p => p.sum],
  ["the setter", p => {
    p.sum = 9;
    return [p.x, p.y, Object.keys(p)];
  }],
  ["the private name", p => p.secret()],
  ["the brand", p => Point.isPoint(p)],
  ["instanceof", p => p instanceof Point],
  ["constructor", p => p.constructor === Point],
  ["prototype", p => Object.getPrototypeOf(p) === Point.prototype],
  ["a store to x", p => {
    p.x = 10.5;
    return [p.x, p.x + p.y];
  }],
  ["x++", p => {
    p.x++;
    return p.x;
  }],
  ["a store to the label", p => {
    p.label = "renamed";
    return p.label.length;
  }],
  ["a store to the note", p => {
    p.note = "noted";
    return [p.note, Object.keys(p)];
  }],
  ["delete the note", p => [delete p.note, "note" in p]],
  ["a pushed tag", p => p.tags.push("second")],
  ["x in", p => ["x" in p, "norm" in p, "sum" in p, "missing" in p]],
  ["own", p => [Object.hasOwn(p, "x"), Object.hasOwn(p, "norm"), Object.hasOwn(p, "sum")]],
  ["keys", p => Object.keys(p)],
  ["JSON", p => JSON.stringify(p)],
  ["for-in", p => {
    const names: string[] = [];
    for (const name in p) names.push(name);
    return names;
  }],
  ["a pattern", p => {
    const { x, y, label } = p;
    return [x, y, label];
  }],
  ["a method taken off and put back", p => {
    const norm = p.norm;
    return norm.call(p);
  }],
];

function total(p: Point): number {
  return p.x + p.y;
}

function distance(p: Point): number {
  return p.norm();
}

function rename(p: Point, label: string): string {
  p.label = label;
  return p.label;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = new Point(i, 0.5);
  warm += total(honest) + distance(honest) + rename(honest, "n").length;
}
for (const [, use] of uses) for (let i = 0; i < 200; i++) use(new Point(i, 0.5));
console.log("after the honest points", warm);

for (const [name, use] of uses) {
  attempt(name, () => use(dressed(new Point(3, 4))));
}
{
  const source = new Point(3, 4);
  const made = dressed(source);
  attempt("typed functions", () => [total(made), distance(made), rename(made, "again")]);
  attempt("is it the source", () => made === source);
  attempt("the source afterwards", () => [source.x, source.y, source.label, source.tags, Object.keys(source)]);
  attempt("a store to the source is seen", () => {
    source.x = 100;
    source.tags.push("late");
    return [made.x, made.tags];
  });
}
attempt("honest again", () => [total(new Point(3, 4)), distance(new Point(3, 4)), rename(new Point(3, 4), "honest")]);

export {};
