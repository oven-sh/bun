// `Object.hasOwn(thing, "name")` where a layout is written of `thing` and nothing is proven: the cell of such an object answers, and whatever else comes asks the run time. ONE DEED: objects of classes below come, one of which lists the extra name and one of which hides the accessor by a field.
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
class Below extends Thing { extra = 1; }
class Hides extends Thing { override above: any = 5; constructor() { super(false); Object.defineProperty(this, "above", { value: 5 }); } }
class Plain extends Thing {}
console.log(show(new Below(true)), attempt(() => show(new Hides())), show(new Plain(false)), show(new Thing(true)));
