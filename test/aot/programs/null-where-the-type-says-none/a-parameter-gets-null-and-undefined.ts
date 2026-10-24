interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
function readX(point: Point): number { return point.x; }
function isNone(point: Point): string { return [point === null, point === undefined, point == null, point == undefined, !point, typeof point].join(); }
function orOrigin(point: Point): number { return (point ?? origin).x + (point?.y ?? 40); }
for (const value of [origin, null, origin, undefined, origin]) {
  attempt("read", () => readX(value as any));
  attempt("none", () => isNone(value as any));
  attempt("or", () => orOrigin(value as any));
}
