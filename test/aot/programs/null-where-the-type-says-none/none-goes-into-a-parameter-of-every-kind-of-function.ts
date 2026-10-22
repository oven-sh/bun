interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
class Shape { point: Point; constructor(point: Point) { this.point = point; } static make(point: Point): number { return point.x; } method(point: Point): number { return point.x + this.point.x; } set moved(point: Point) { this.point = { x: point.x, y: 0 }; } }
const arrow = (point: Point): number => point.x;
async function later(point: Point): Promise<number> { return point.x; }
function* many(point: Point): Generator<number> { yield point.x; yield point.y; }
const bound = function (this: Point, point: Point): number { return this.x + point.x; }.bind(origin);
const literal = { method(point: Point): number { return point.y; } };
for (const value of [origin, null, undefined, origin] as Point[]) {
  attempt("constructor", () => new Shape(value).point === value); attempt("static", () => Shape.make(value)); attempt("method", () => new Shape(origin).method(value));
  attempt("setter", () => { const shape = new Shape(origin); shape.moved = value; return shape.point.x; }); attempt("arrow", () => arrow(value)); attempt("generator", () => [...many(value)].join());
  attempt("bound", () => bound(value)); attempt("literal", () => literal.method(value));
  console.log("async", await later(value).then(String, error => error.constructor.name));
}
