// Turning a declared property of an object born in a .ts file into an accessor, or making it read-only, hidden or locked, throws a TypeError and leaves the property as it was. Plain Bun redefines it.
// Columns: fields wide kinds types
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", (e as Error).constructor.name); }
}
interface Point { x: number; y?: number }
class Pair { x: number = 1; y?: number }
function Made(this: Point) { this.x = 1; }
const makers: [string, () => any][] = [
  ["a class instance", () => new Pair()],
  ["a literal", () => { const point: Point = { x: 1 }; return point; }],
  ["what a constructor function makes", () => new (Made as any)()],
];
const operations: [string, (o: any) => unknown][] = [
  ["a getter", o => Object.defineProperty(o, "x", { get() { return 7; }, enumerable: true, configurable: true }).x],
  ["a setter", o => { Object.defineProperty(o, "x", { set(_: number) {}, enumerable: true, configurable: true }); return "defined"; }],
  ["read-only", o => { Object.defineProperty(o, "x", { writable: false }); return "defined"; }],
  ["hidden", o => { Object.defineProperty(o, "x", { enumerable: false }); return "defined"; }],
  ["locked", o => { Object.defineProperty(o, "x", { configurable: false }); return "defined"; }],
  ["Reflect.defineProperty with a getter", o => Reflect.defineProperty(o, "x", { get() { return 7; } })],
  ["__defineGetter__", o => { o.__defineGetter__("x", () => 7); return o.x; }],
  ["__defineSetter__", o => { o.__defineSetter__("x", () => {}); return "defined"; }],
  ["Object.defineProperties behind a new property", o => { Object.defineProperties(o, { fresh: { value: 1, enumerable: true }, x: { get() { return 7; } } }); return "defined"; }],
];
for (const [how, make] of makers) {
  for (const [what, operation] of operations) {
    const o = make();
    attempt(how + ", " + what, () => operation(o));
    console.log("  afterwards:", JSON.stringify(Object.getOwnPropertyDescriptor(o, "x")), o.x);
  }
}
for (const [how, make] of makers.slice(0, 2)) {
  const o = make();
  delete o.y;
  attempt(how + ", an absent optional property defined with a value alone", () => { Object.defineProperty(o, "y", { value: 2 }); return "defined"; });
  console.log("  afterwards:", "y" in o);
}
