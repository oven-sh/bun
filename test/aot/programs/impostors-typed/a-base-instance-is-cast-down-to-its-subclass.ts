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

class Shape {
  sides = 4;
}

class Square extends Shape {
  edge = 2;
  label = "square";
  inner = { n: 1 };
  area(): number {
    return this.edge * this.edge;
  }
}

class Cube extends Square {
  depth = 3;
}

function edgeTwice(q: Square): number {
  return q.edge * 2;
}

function labelSize(q: Square): number {
  return q.label.length;
}

function areaOf(q: Square): number {
  return q.area();
}

function grow(q: Square): number {
  q.edge += 1;
  return q.edge;
}

attempt("honest", () => [edgeTwice(new Square()), labelSize(new Square()), areaOf(new Square()), grow(new Square()), edgeTwice(new Cube())]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += edgeTwice(new Square()) + labelSize(new Square()) + areaOf(new Cube()) + grow(new Square());
console.log("2000 honest rounds", warm);

attempt("as, read in place", () => (new Shape() as Square).edge);
attempt("as, arithmetic in place", () => (new Shape() as Square).edge * 2);
attempt("as, typeof", () => typeof (new Shape() as Square).edge);
attempt("as, a string field", () => (new Shape() as Square).label.length);
attempt("as, an object field", () => (new Shape() as Square).inner.n);
attempt("as, a method", () => (new Shape() as Square).area());
attempt("as, a store", () => {
  const q = new Shape() as Square;
  q.edge = 9;
  return [q.edge, Object.keys(q)];
});
attempt("as, an update", () => {
  const q = new Shape() as Square;
  q.edge++;
  return [q.edge, Object.keys(q)];
});
attempt("as, handed to typed functions", () => [edgeTwice(new Shape() as Square), grow(new Shape() as Square)]);
attempt("as, handed to a typed function that reads a string", () => labelSize(new Shape() as Square));
attempt("as, handed to a typed function that calls", () => areaOf(new Shape() as Square));
attempt("an angle bracket", () => (<Square>new Shape()).edge * 2);
attempt("through unknown", () => (new Shape() as unknown as Square).edge * 2);
attempt("through any", () => {
  const loose: any = new Shape();
  const q: Square = loose;
  return q.edge * 2;
});
attempt("two levels down", () => [(new Shape() as Cube).depth, (new Square() as Cube).depth, (new Square() as Cube).edge]);
attempt("kept in a local, a field, an element and a closure", () => {
  const local = new Shape() as Square;
  const holder: { q: Square } = { q: new Shape() as Square };
  const list: Square[] = [new Square(), new Shape() as Square];
  const read = () => local.edge;
  return [local.edge, holder.q.edge, list.map(q => q.edge), read()];
});
attempt("in a loop over squares and one shape", () => {
  const list: Square[] = [];
  for (let i = 0; i < 2000; i++) list.push(new Square());
  list.push(new Shape() as Square);
  let sum = 0;
  for (const q of list) sum += q.edge;
  return sum;
});
attempt("instanceof after the cast", () => {
  const q = new Shape() as Square;
  return [q instanceof Square, q instanceof Shape, q.sides];
});
attempt("a sibling through the base", () => {
  class Circle extends Shape {
    radius = 1;
  }
  const s: Shape = new Circle();
  return [(s as Square).edge, (s as Circle).radius];
});
attempt("honest again", () => [edgeTwice(new Square()), labelSize(new Square()), areaOf(new Square()), grow(new Square())]);
