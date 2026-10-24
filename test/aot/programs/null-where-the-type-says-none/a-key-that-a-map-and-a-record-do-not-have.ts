interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
const map = new Map<string, Point>([["a", origin]]);
const record: Record<string, Point> = { a: origin };
const byNumber: { [index: number]: string } = { 1: "one" };
function fromMap(key: string): Point { return map.get(key)!; }
function fromRecord(key: string): Point { return record[key]; }
function text(index: number): string { return byNumber[index]; }
for (const key of ["a", "b", "a"]) { attempt("map", () => fromMap(key).x); attempt("map none", () => fromMap(key) === undefined); attempt("record", () => fromRecord(key).y); attempt("record none", () => typeof fromRecord(key)); }
for (const index of [1, 2]) { attempt("text", () => text(index).length); attempt("text none", () => text(index) === undefined); }
