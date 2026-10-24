interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
function readX(point: Point, other: Point): string { return point.x + ":" + (other === undefined ? "u" : other === null ? "n" : other.y); }
attempt("call", () => readX.call(undefined, origin, null as any)); attempt("call", () => readX.call(undefined, null as any, origin)); attempt("apply", () => readX.apply(undefined, [origin] as any)); attempt("apply", () => readX.apply(undefined, [] as any));
attempt("reflect", () => Reflect.apply(readX, undefined, [origin, undefined])); attempt("reflect", () => Reflect.apply(readX, undefined, [undefined, origin])); attempt("right", () => readX(origin, origin));
