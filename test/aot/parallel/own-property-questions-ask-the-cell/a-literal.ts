// `Object.hasOwn(thing, "name")` where a layout is written of `thing` and nothing is proven: the cell of such an object answers, and whatever else comes asks the run time. ONE DEED: the objects of a literal with an optional name.
class Thing {
  filled = 1;
  sometimes?: number;
  constructor(withIt: boolean) { if (withIt) this.sometimes = 2; }
  get above() { return 3; }
  method() { return 4; }
}
const holder = ((globalThis as any).holder = { things: [] as unknown[] });
// Nothing is proven of the parameter: whoever has the function may hand it anything.
function ask(thing: Thing) {
  return [Object.hasOwn(thing, "filled"), Object.hasOwn(thing, "sometimes"), Object.hasOwn(thing, "above"), Object.hasOwn(thing, "method"), Object.hasOwn(thing, "extra"), Object.hasOwn(thing, "toString")].map(Number).join("");
}
function askByMethod(thing: Thing) {
  return [thing.hasOwnProperty("filled"), thing.hasOwnProperty("sometimes"), thing.hasOwnProperty("above"), thing.hasOwnProperty("extra")].map(Number).join("");
}
(holder as any).ask = ask;
(holder as any).askByMethod = askByMethod;
const attempt = (f: () => unknown) => { try { return f(); } catch (e: any) { return e.constructor.name; } };
const show = (thing: unknown) => attempt(() => (holder as any).ask(thing)) + " " + attempt(() => (holder as any).askByMethod(thing));
interface Options { always: number; maybe?: number; }
function askOptions(options: Options) { return [Object.hasOwn(options, "always"), Object.hasOwn(options, "maybe"), Object.hasOwn(options, "other")].map(Number).join(""); }
(holder as any).askOptions = askOptions;
const make = (i: number): Options => (i % 2 ? { always: i } : { always: i, maybe: i });
const all: Options[] = [make(0), make(1), make(2), { always: 1, ...{ other: 2 } } as Options, JSON.parse('{"maybe":1,"other":2}')];
console.log(all.map((options) => (holder as any).askOptions(options)).join());
