// New properties can be added to an object born in a .ts file, redefined and deleted again, as in plain Bun: the rule speaks of declared properties only.
interface Point { x: number }
class Pair { x: number = 1 }
function Made(this: Point) { this.x = 1; }
const makers: [string, () => any][] = [
  ["a class instance", () => new Pair()],
  ["a literal", () => { const point: Point = { x: 1 }; return point; }],
  ["what a constructor function makes", () => new (Made as any)()],
];
const key = ["com", "puted"].join("");
const symbol = Symbol("added");
for (const [how, make] of makers) {
  const o = make();
  o.extra = "e";
  o[key] = 2;
  o[symbol] = 3;
  o[0] = "zero";
  Object.defineProperty(o, "hidden", { value: 4, enumerable: false, configurable: true });
  Object.defineProperty(o, "computedOnRead", { get() { return this.x + 1; }, enumerable: true, configurable: true });
  Object.assign(o, { assigned: 5 });
  console.log(how + ":", JSON.stringify(o), Reflect.ownKeys(o).map(String).join(), o.hidden, o.computedOnRead);
  o.extra = 6;
  Object.defineProperty(o, "extra", { get() { return "getter"; }, configurable: true });
  console.log("  redefined:", o.extra, JSON.stringify(Object.getOwnPropertyDescriptor(o, "extra")));
  console.log("  deleted:", delete o.extra, delete o[key], delete o[symbol], delete o[0], delete o.hidden, Reflect.ownKeys(o).map(String).join());
  o.x = 7;
  console.log("  the declared property:", o.x, o.computedOnRead);
}
