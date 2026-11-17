// Casts whose result is not used as a value of the type: asked for its typeof, or dropped.
const say = (label: string, f: () => unknown): void => { let r: string; try { r = String(f()); } catch (e) { r = "throws " + (e as Error).name + ": " + (e as Error).message.split("\n")[0].replace(/ \(bun compile[^)]*\)/, "").replace(/ \(declared at [^)]*\)/g, ""); } console.log(label + " ==> " + r); };
interface Element { tag: string; props: object }
const held = (x: unknown) => { const e = x as Element; return typeof e; };
say("kept, and only asked for its typeof", () => held("a"));
const dropped = (x: unknown) => { x as Element; return 1; };
say("dropped", () => dropped("a"));
const text = (x: unknown) => typeof (x as string);
say("a symbol cast to string, asked for its typeof", () => text(Symbol("s")));
