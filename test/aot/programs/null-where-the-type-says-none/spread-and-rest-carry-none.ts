interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
function three(first: Point, second: Point, third: Point): string { return [first, second, third].map(point => point === undefined ? "u" : point === null ? "n" : point.x).join(); }
function rest(...points: Point[]): string { return points.length + ":" + points.map(point => point?.x ?? "none").join(); }
const holes = [origin, , origin] as Point[];
attempt("three", () => three(...(holes as [Point, Point, Point]))); attempt("rest", () => rest(...holes)); attempt("rest", () => rest(null as any, undefined as any)); attempt("copy", () => JSON.stringify({ ...({ point: null } as unknown as { point: Point }) }));
attempt("read", () => ((first: Point, second: Point) => second.x)(...(holes as [Point, Point])));
