// `Object.hasOwn(thing, "name")` where a layout is written of `thing` and nothing is proven: the cell of such an object answers, and whatever else comes asks the run time. ONE DEED: the objects of a constructor function, with names that strangers store.
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
function Old(this: any, a: number) { this.first = a; }
Old.prototype.shared = 1;
interface OldThing { first: number; later?: number; shared: number; }
function askOld(old: OldThing) { return [Object.hasOwn(old, "first"), Object.hasOwn(old, "later"), Object.hasOwn(old, "shared"), Object.hasOwn(old, "never")].map(Number).join(""); }
(holder as any).askOld = askOld; (holder as any).Old = Old;
const olds = [0, 1, 2].map((i) => new (holder as any).Old(i));
olds[1].later = 5;
olds[2].never = 6;
console.log(olds.map((old) => (holder as any).askOld(old)).join());
