interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
function same<T>(value: T): T { return value; }
function firstOf<T>(values: T[]): T { return values[0]; }
class Cell<T> { constructor(public value: T) {} get(): T { return this.value; } }
function read(point: Point): string { return point === undefined ? "undefined" : point === null ? "null" : "x " + point.x; }
attempt("same", () => read(same<Point>(null as any))); attempt("same", () => read(same<Point>(origin))); attempt("first", () => read(firstOf<Point>([]))); attempt("first x", () => firstOf<Point>([]).x);
attempt("cell", () => read(new Cell<Point>(undefined as any).get())); attempt("cell x", () => new Cell<Point>(null as any).get().x); attempt("cell", () => new Cell<Point>(origin).get().x);
