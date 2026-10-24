interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
class Holder { point: Point = origin; next: Holder | undefined; }
function readX(point: Point): number { return point.x; }
function viaTwo(point: Point): number { return readX(point) + 1; }
function isNone(point: Point): boolean { return point === null || point === undefined; }
function use(holder: Holder): string { return [isNone(holder.point), viaTwo(holder.point)].join(); }
const holder = new Holder();
attempt("use", () => use(holder)); holder.point = null as any; attempt("use", () => use(holder)); attempt("none", () => isNone(holder.point));
holder.point = undefined as any; attempt("use", () => use(holder)); attempt("none", () => isNone(holder.point)); holder.point = { x: 7, y: 8 }; attempt("use", () => use(holder));
