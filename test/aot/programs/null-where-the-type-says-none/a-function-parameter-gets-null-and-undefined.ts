interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
function call(run: () => number): number { return run(); }
function tested(run: () => number): string { return [run === null, run === undefined, typeof run, run?.() ?? "none"].join(); }
for (const value of [() => 7, null, undefined, () => 8]) { attempt("call", () => call(value as any)); attempt("tested", () => tested(value as any)); }
