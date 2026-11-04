// `Object.hasOwn(thing, "name")` where a layout is written of `thing` and nothing is proven: the cell of such an object answers, and whatever else comes asks the run time. ONE DEED: the answer is branched on, negated, stored, returned.
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
function branches(thing: Thing) {
  const kept = Object.hasOwn(thing, "sometimes");
  if (!Object.hasOwn(thing, "extra") && Object.hasOwn(thing, "filled")) return kept ? "both" : "filled";
  return Object.hasOwn(thing, "extra") ? "extra" : "none";
}
(holder as any).branches = branches;
const extra: any = new Thing(false); extra.extra = 1;
const none: any = new Thing(true); delete none.filled;
console.log([new Thing(true), new Thing(false), extra, none, {}].map((thing) => (holder as any).branches(thing)).join());
