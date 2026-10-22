interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
const list: Point[] = [origin, { x: 3, y: 4 }];
const holes: Point[] = new Array<Point>(3); holes[1] = origin;
const sparse: Point[] = [origin, , origin] as Point[];
function at(points: Point[], index: number): Point { return points[index]; }
function readAt(points: Point[], index: number): number { const point: Point = points[index]; return point.x; }
function testAt(points: Point[], index: number): string { const point: Point = points[index]; return [point === undefined, typeof point, point?.x ?? "none"].join(); }
for (const points of [list, holes, sparse]) for (const index of [0, 1, 2, 5, -1]) { attempt("at", () => JSON.stringify(at(points, index))); attempt("read", () => readAt(points, index)); attempt("test", () => testAt(points, index)); }
let total = 0; for (const point of holes) total += point === undefined ? 100 : point.x; console.log(total);
attempt("for of", () => { let sum = 0; for (const point of sparse) sum += point.x; return sum; });
