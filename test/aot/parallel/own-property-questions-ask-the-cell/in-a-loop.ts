// `Object.hasOwn(thing, "name")` where a layout is written of `thing` and nothing is proven: the cell of such an object answers, and whatever else comes asks the run time. ONE DEED: the question stands in a loop over mixed objects.
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
const mixed: unknown[] = [];
for (let i = 0; i < 50; i++) { const thing: any = i % 5 === 4 ? { filled: i } : new Thing(i % 2 === 0); if (i % 7 === 0) thing.extra = i; if (i % 11 === 0) delete thing.filled; mixed.push(thing); }
function count(things: Thing[]) { let n = 0; for (const thing of things) { if (Object.hasOwn(thing, "filled")) n += 1; if (Object.hasOwn(thing, "sometimes")) n += 100; if (Object.hasOwn(thing, "extra")) n += 10000; } return n; }
(holder as any).count = count;
console.log((holder as any).count(mixed), (holder as any).count(mixed));
