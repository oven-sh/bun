interface Point { x: number; y: number; kept: number; }
function Point(this: Point, x: number, y: number) { this.x = x; this.y = y; }
const make = Point as unknown as new (x: number, y: number) => Point;
function sum(p: Point) { return p.x + p.y; }
function show(p: Point) { return [sum(p), Object.keys(p).join("+"), Object.hasOwn(p, "x"), JSON.stringify(p), JSON.stringify({ ...p })].join(" "); }
let total = 0;
for (let i = 0; i < 50; i++)
    total += sum(new make(i, 1));
const early = new make(1.5, 2);
Object.defineProperty(Point.prototype, "x", { get(this: Point) { return this.kept + 100; }, set(this: Point, v: number) { this.kept = v; }, configurable: true });
const late = new make(2.5, 3);
early.x = 7;
late.x = 8;
console.log(total, show(early), "|", show(late));
