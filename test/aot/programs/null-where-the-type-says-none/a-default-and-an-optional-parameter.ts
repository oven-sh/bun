interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
function withDefault(point: Point = origin): number { return point.x; }
function optional(point?: Point): string { return point === undefined ? "none" : "x " + point.x; }
function both(first: Point, second: Point = first): number { return second.y; }
attempt("default", () => withDefault()); attempt("default", () => withDefault(undefined)); attempt("default null", () => withDefault(null as any)); attempt("default", () => withDefault({ x: 9, y: 9 }));
attempt("optional", () => optional()); attempt("optional", () => optional(origin)); attempt("optional null", () => optional(null as any));
attempt("both", () => both(origin)); attempt("both", () => both(undefined as any)); attempt("both", () => both(origin, null as any));
