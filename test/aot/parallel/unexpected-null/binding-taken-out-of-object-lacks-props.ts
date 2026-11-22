// A binding taken out of an object that lacks the property.
interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
function take(holder: { point: Point; name: string }): string { const { point, name } = holder; return [point === undefined, name === undefined, point?.x ?? "no x", typeof name].join(); }
function takeAndRead({ point }: { point: Point }): number { return point.x; }
function first([head]: Point[]): number { return head.x; }
attempt("take", () => take({} as any)); attempt("take", () => take({ point: origin, name: "n" })); attempt("take", () => take({ point: null, name: null } as any));
attempt("read", () => takeAndRead({} as any)); attempt("read", () => takeAndRead({ point: origin })); attempt("first", () => first([])); attempt("first", () => first([origin]));
