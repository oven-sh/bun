interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
function length(text: string): number { return text.length; }
function joined(text: string): string { return text + "|" + `${text}` + "|" + [text].join() + "|" + String(text) + "|" + JSON.stringify({ text }); }
function tested(text: string): string { return [text === null, text === undefined, text == null, !text, typeof text, text === "", text ?? "other"].join(); }
for (const value of ["ab", null, "", undefined, "c"]) { attempt("length", () => length(value as any)); attempt("joined", () => joined(value as any)); attempt("tested", () => tested(value as any)); }
