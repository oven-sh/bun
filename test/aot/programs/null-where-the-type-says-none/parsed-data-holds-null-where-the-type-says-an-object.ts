interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
interface Line { from: Point; to: Point; label: string }
const lines: Line[] = JSON.parse('[{"from":{"x":1,"y":2},"to":null,"label":"a"},{"from":null,"to":{"x":3,"y":4}},{"from":{"x":5,"y":6},"to":{"x":7,"y":8},"label":null}]');
function span(line: Line): number { return line.to.x - line.from.x; }
function label(line: Line): string { return line.label + ":" + (line.label === undefined) + ":" + (line.label === null) + ":" + (line.label?.length ?? "none"); }
for (const line of lines) { attempt("span", () => span(line)); attempt("label", () => label(line)); attempt("to", () => [line.to === null, line.from === null, line.to == undefined].join()); }
