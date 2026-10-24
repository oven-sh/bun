interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
function cleared(point: Point): string { const before = point.x; point = null as any; return [before, point === null, typeof point, point?.x ?? "none"].join(); }
function clearedThenRead(point: Point): number { point = undefined as any; return point.x; }
function inLoop(point: Point, rounds: number): number { let sum = 0; for (let index = 0; index < rounds; index++) { if (point == null) { sum += 100; point = origin; } else { sum += point.x; point = (index % 2 ? null : undefined) as any; } } return sum; }
function captured(point: Point): string { const look = () => point === null ? "null" : "x " + point.x; const first = look(); point = null as any; return first + " " + look(); }
attempt("cleared", () => cleared(origin)); attempt("then read", () => clearedThenRead(origin)); attempt("in loop", () => inLoop(origin, 7)); attempt("captured", () => captured(origin));
