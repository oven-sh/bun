interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
type Pair = [Point, Point];
function second(pair: Pair): number { return pair[1].x; }
function test([first, other]: Pair): string { return [first === undefined, other === undefined, other?.y ?? "none"].join(); }
attempt("second", () => second([origin, origin])); attempt("second", () => second([origin] as any)); attempt("test", () => test([origin] as any)); attempt("test", () => test([] as any)); attempt("test", () => test([origin, null] as any));
