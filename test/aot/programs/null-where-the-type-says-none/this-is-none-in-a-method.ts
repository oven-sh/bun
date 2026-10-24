interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
class Meter { value = 5; read(): number { return this.value; } test(): string { return [this === undefined, this === null, typeof this].join(); } }
const meter = new Meter(); const { read, test } = meter;
attempt("read", () => meter.read()); attempt("loose read", () => read()); attempt("loose test", () => test());
attempt("call null", () => meter.read.call(null as any)); attempt("test null", () => meter.test.call(null as any)); attempt("test undefined", () => meter.test.call(undefined as any));
function typed(this: Point): number { return this.x; }
attempt("typed", () => typed.call(origin)); attempt("typed null", () => typed.call(null as any)); attempt("typed loose", () => (typed as any)());
