interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
interface Line { from: Point; to: Point }
function make(what: number): Line { return { from: origin, to: (what === 0 ? origin : what === 1 ? null : undefined) as any }; }
function span(line: Line): number { return line.to.x - line.from.x; }
function test(line: Line): string { return [line.to === null, line.to === undefined, "to" in line, Object.keys(line).join("+"), JSON.stringify(line)].join(); }
for (const what of [0, 1, 2, 0]) { attempt("span", () => span(make(what))); attempt("test", () => test(make(what))); }
