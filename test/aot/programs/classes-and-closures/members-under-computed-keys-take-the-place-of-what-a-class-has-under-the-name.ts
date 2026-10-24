// A member that the body of a class defines under a computed key takes the place of what the class has under that name from its creation, or of an earlier member. Classes below see it too.
class OnlySetter { set ["constructor"](value: unknown) {} }
class Below extends OnlySetter {}
class Further extends Below {}
class OnlyGetter { get ["constructor"]() { return Array; } }
class BelowGetter extends OnlyGetter {}
class Method { ["constructor"]() { return "called"; } }
class BelowMethod extends Method {}
const key = "constructor";
class ByVariable { get [key]() { return Map; } }
class BelowByVariable extends ByVariable {}

function nameOf(value: unknown): string {
  return typeof value === "function" ? value.name || "(no name)" : String(value);
}
function readTyped(a: OnlySetter, b: Below, c: Further, d: OnlyGetter, e: BelowGetter, f: Method, g: BelowMethod, h: ByVariable, i: BelowByVariable): string {
  return [a.constructor, b.constructor, c.constructor, d.constructor, e.constructor, f.constructor, g.constructor, h.constructor, i.constructor].map(nameOf).join();
}
function readAny(values: any[]): string {
  return values.map(value => nameOf(value.constructor)).join();
}
const make = () => [new OnlySetter(), new Below(), new Further(), new OnlyGetter(), new BelowGetter(), new Method(), new BelowMethod(), new ByVariable(), new BelowByVariable()] as const;

let last = "";
for (let round = 0; round < 20000; round++) {
  const both = readTyped(...make()) + " | " + readAny([...make()]);
  if (both !== last) console.log(round, both);
  last = both;
}
delete (Below.prototype as any).constructor;
delete (BelowGetter.prototype as any).constructor;
delete (BelowMethod.prototype as any).constructor;
delete (BelowByVariable.prototype as any).constructor;
console.log("own ones deleted", readTyped(...make()), "|", readAny([...make()]));
delete (Further.prototype as any).constructor;
console.log("one more", readTyped(...make()), "|", readAny([...make()]));
Object.defineProperty(OnlySetter.prototype, "constructor", { value: Set, configurable: true });
Object.defineProperty(OnlyGetter.prototype, "constructor", { get() { return WeakMap; }, configurable: true });
console.log("defined anew", readTyped(...make()), "|", readAny([...make()]));
console.log(new (new BelowGetter().constructor as any)() instanceof WeakMap, (new BelowMethod() as any).constructor(), Object.getOwnPropertyNames(OnlySetter.prototype).join(), Object.getOwnPropertyNames(Method.prototype).join());
