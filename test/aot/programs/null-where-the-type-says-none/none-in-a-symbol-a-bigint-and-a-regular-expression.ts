interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
function describe(mark: symbol): string { return mark.description ?? "no description"; }
function double(big: bigint): bigint { return big * 2n; }
function matches(pattern: RegExp): boolean { return pattern.test("abc"); }
function day(date: Date): number { return date.getTime(); }
for (const none of [null, undefined]) { attempt("symbol", () => describe(none as any)); attempt("bigint", () => double(none as any)); attempt("regexp", () => matches(none as any)); attempt("date", () => day(none as any)); }
attempt("symbol", () => describe(Symbol("s"))); attempt("bigint", () => double(4n)); attempt("regexp", () => matches(/b/)); attempt("date", () => day(new Date(5)));
