interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
const list: Point[] = [origin]; const map = new Map<string, Point>([["a", origin]]);
function give(ok: boolean): Point { return (ok ? origin : null) as any; }
function readY(point: Point): number { return point.y; }
function kind(point: Point): string { return point === undefined ? "undefined" : point === null ? "null" : "point"; }
for (const index of [0, 1]) { attempt("list", () => readY(list[index])); attempt("list kind", () => kind(list[index])); }
for (const key of ["a", "b"]) { attempt("map", () => readY(map.get(key)!)); attempt("map kind", () => kind(map.get(key)!)); }
for (const ok of [true, false]) { attempt("call", () => readY(give(ok))); attempt("call kind", () => kind(give(ok))); }
