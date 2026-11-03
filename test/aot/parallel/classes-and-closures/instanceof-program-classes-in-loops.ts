class Shape { constructor(public id: number) { } }
class Circle extends Shape { constructor(id: number, public radius: number) { super(id); } }
class Square extends Shape { constructor(id: number, public side: number) { super(id); } }
class Ring extends Circle { constructor(id: number, radius: number, public hole: number) { super(id, radius); } }
class Lone { constructor(public n: number) { } }
class Odd { static [Symbol.hasInstance](v: unknown): boolean { return typeof v === "number"; } }
const lines: string[] = [];
function shapesThatAre(all: Shape[]): string { let shape = 0, circle = 0, square = 0, ring = 0, lone = 0; for (let i = 0; i < all.length; i++) { const s = all[i]; if (s instanceof Shape) shape++; if (s instanceof Circle) circle++; if (s instanceof Square) square++; if (s instanceof Ring) ring++; if ((s as unknown) instanceof Lone) lone++; } return [shape, circle, square, ring, lone].join(" "); }
function maybeShapesThatAre(all: Array<Shape | undefined | null>): string { let shape = 0, circle = 0, ring = 0; for (const s of all) { if (s instanceof Shape) shape++; if (s instanceof Circle) circle++; if (s instanceof Ring) ring++; } return [shape, circle, ring].join(" "); }
function unionsThatAre(all: Array<Circle | Lone | number | string | number[] | Map<string, number>>): string { let circle = 0, lone = 0, ring = 0; for (const s of all) { if (s instanceof Circle) circle++; if (s instanceof Lone) lone++; if (s instanceof Ring) ring++; } return [circle, lone, ring].join(" "); }
function anythingThatIs(all: any[]): string { let shape = 0, circle = 0, square = 0, ring = 0, lone = 0, odd = 0; for (let i = 0; i < all.length; i++) { const s = all[i]; if (s instanceof Shape) shape++; if (s instanceof Circle) circle++; if (s instanceof Square) square++; if (s instanceof Ring) ring++; if (s instanceof Lone) lone++; if (s instanceof Odd) odd++; } return [shape, circle, square, ring, lone, odd].join(" "); }
function each(all: any[]): string { let text = ""; for (const s of all) text += (s instanceof Shape ? "S" : "-") + (s instanceof Circle ? "C" : "-") + (s instanceof Ring ? "R" : "-") + (s instanceof Lone ? "L" : "-") + " "; return text; }
const shapes: Shape[] = [new Shape(1), new Circle(2, 1), new Square(3, 1), new Ring(4, 2, 1), new Circle(5, 1), new Ring(6, 2, 1)];
const anything: any[] = [...shapes, new Lone(1), undefined, null, 5, "text", true, 5n, Symbol.iterator, {}, [], new Map(), () => 1, Shape, Circle.prototype, Object.create(Circle.prototype), Object.create(Ring.prototype), Object.create(null),
    Object.setPrototypeOf({ id: 1 }, Square.prototype), new Proxy(new Circle(7, 1), {}), new Proxy({}, { getPrototypeOf() { return Ring.prototype; } }), { id: 1, radius: 2 }];
function table(title: string): void {
    lines.push("== " + title);
    lines.push("shapes: " + shapesThatAre(shapes));
    lines.push("maybe: " + maybeShapesThatAre([...shapes, undefined, null]));
    lines.push("unions: " + unionsThatAre([new Circle(1, 1), new Lone(1), 5, "x", [1], new Map(), new Ring(2, 1, 1)]));
    lines.push("anything: " + anythingThatIs(anything));
    lines.push("each: " + each(anything));
}
function attempt(what: string, run: () => unknown): void { try { run(); lines.push(what + ": done"); } catch (e) { lines.push(what + ": throws " + (e as Error).constructor.name); } }
table("as declared");
attempt("a harmless static", () => { (Circle as any).extra = 1; });
table("Circle was given a harmless property");
attempt("Circle[Symbol.hasInstance]", () => (Object as any)["define" + "Property"](Circle, Symbol.hasInstance, { value: (v: unknown) => v === 5, configurable: true }));
table("Circle was given a Symbol.hasInstance");
attempt("Lone.prototype = ..", () => { (Lone as any).prototype = Shape.prototype; });
attempt("setPrototypeOf(Ring.prototype, Lone.prototype)", () => (Object as any)["set" + "PrototypeOf"](Ring.prototype, Lone.prototype));
attempt("setPrototypeOf(a ring, Lone.prototype)", () => (Object as any)["set" + "PrototypeOf"](shapes[3], Lone.prototype));
table("after the attempts on prototypes");
attempt("delete Circle[Symbol.hasInstance]", () => { delete (Circle as any)[Symbol.hasInstance]; });
table("deleted again");
console.log(lines.join("\n"));
