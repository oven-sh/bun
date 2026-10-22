interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
function maybe(give: boolean): Point | undefined { return give ? origin : undefined; }
function orNull(give: boolean): Point | null { return give ? origin : null; }
function read(give: boolean): number { const point = maybe(give)!; return point.x; }
function tested(give: boolean): string { const point: Point = orNull(give)!; return [point === null, point == undefined, typeof point, point?.y ?? "none"].join(); }
function passedOn(give: boolean): string { return describe(maybe(give)!); }
function describe(point: Point): string { return point === undefined ? "none arrived" : "x " + point.x; }
for (const give of [true, false, true]) { attempt("read", () => read(give)); attempt("tested", () => tested(give)); attempt("passed on", () => passedOn(give)); }
