interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
function give(what: number): Point { return (what === 0 ? origin : what === 1 ? null : undefined) as any; }
function giveText(what: number): string { return (what === 0 ? "t" : what === 1 ? null : undefined) as any; }
function use(what: number): number { return give(what).x; }
function test(what: number): string { const point = give(what), text = giveText(what); return [point === null, point === undefined, typeof point, text === null, text === undefined, text + "", point?.x ?? "none"].join(); }
for (const what of [0, 1, 2, 0]) { attempt("use", () => use(what)); attempt("test", () => test(what)); attempt("length", () => giveText(what).length); }
