// `Object.hasOwn(thing, "name")` where a layout is written of `thing` and nothing is proven: the cell of such an object answers, and whatever else comes asks the run time. ONE DEED: classes below Error, Array, Map, Function and Promise: what the built-in class lays on the object is no field.
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
class MyError extends Error { code = 1; }
class MyList extends Array<number> { tag = 1; }
class MyMap extends Map<string, number> { tag = 1; }
function askError(e: MyError) { return [Object.hasOwn(e, "code"), Object.hasOwn(e, "message"), Object.hasOwn(e, "stack"), Object.hasOwn(e, "name"), Object.hasOwn(e, "cause")].map(Number).join(""); }
function askList(l: MyList) { return [Object.hasOwn(l, "tag"), Object.hasOwn(l, "length"), Object.hasOwn(l, "push")].map(Number).join(""); }
function askMap(m: MyMap) { return [Object.hasOwn(m, "tag"), Object.hasOwn(m, "size")].map(Number).join(""); }
Object.assign(holder, { askError, askList, askMap });
for (let i = 0; i < 2; i++) console.log((holder as any).askError(new MyError("m", { cause: 1 })), (holder as any).askError(new MyError()), (holder as any).askList(new MyList()), (holder as any).askMap(new MyMap()));
