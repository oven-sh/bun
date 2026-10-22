interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
function sum(first: Point, second: Point): number { return first.x + second.y; }
function count(first: Point, second: Point): string { return [arguments.length, second === undefined, typeof second].join(); }
attempt("both", () => sum(origin, origin));
attempt("one", () => (sum as any)(origin));
attempt("none", () => (sum as any)());
attempt("count", () => (count as any)(origin));
attempt("both again", () => sum(origin, origin));
