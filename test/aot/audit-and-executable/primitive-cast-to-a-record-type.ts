// `x as T`, where T is a record type and x is a string, a number or a boolean when the program runs.
const say = (label: string, f: () => unknown): void => { let r: string; try { r = String(f()); } catch (e) { r = "throws " + (e as Error).name + ": " + (e as Error).message.split("\n")[0].replace(/ \(bun compile[^)]*\)/, "").replace(/ \(declared at [^)]*\)/g, ""); } console.log(label + " ==> " + r); };
const key = Symbol("matcher");
interface Matcher { [key]: () => boolean; name: string }
const isMatcher = (x: unknown): x is Matcher => { const pattern = x as Matcher; return pattern && !!pattern[key]; };
const real: Matcher = { [key]: () => true, name: "m" };
say("a string", () => isMatcher("a"));
say("a number", () => isMatcher(1));
say("true", () => isMatcher(true));
say("zero", () => isMatcher(0));
say("undefined", () => isMatcher(undefined));
say("a record of the type", () => isMatcher(real));
say("an untyped object", () => isMatcher(JSON.parse("{}")));
interface Element { tag: string; props: object; render?: () => string }
const first = (children: (Element | string | number)[]) => (children[0] as Element)?.tag === "";
say("an element of a union, read through ?. on the spot: a string", () => first(["Hello"]));
say("an element of a union, read through ?. on the spot: a number", () => first([1]));
say("an element of a union, read through ?. on the spot: a record", () => first([{ tag: "", props: {} }]));
const fromUnknown = (x: unknown) => (x as Element)?.["tag"] === "";
say("read through ?.[ ] on the spot: a string", () => fromUnknown("Hello"));
say("read through ?.[ ] on the spot: undefined", () => fromUnknown(undefined));
const holder = { name: "holder", element: { tag: "t", props: {}, render() { return this.tag; } } as Element };
say("a method called through ?.( ) keeps its receiver", () => (holder.element.render as () => string)?.());
say("a method called through ?.name( ) keeps its receiver", () => (holder.element as Element)?.render?.());
