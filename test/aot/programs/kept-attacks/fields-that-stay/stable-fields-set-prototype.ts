// An object born in a .ts file keeps the prototype of its birth: giving it another one throws a TypeError, however it is spelled. Only the prototype of an object literal can be removed (null). Plain Bun changes the prototype.
// Columns: fields wide kinds types
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", (e as Error).constructor.name); }
}
interface Point { x: number }
class Pair { x: number = 1; twice() { return this.x * 2; } }
function Made(this: Point) { this.x = 1; }
const makers: [string, () => any][] = [
  ["a class instance", () => new Pair()],
  ["a literal", () => { const point: Point = { x: 1 }; return point; }],
  ["what a constructor function makes", () => new (Made as any)()],
];
const other = { twice() { return -1; } };
const operations: [string, (o: any) => unknown][] = [
  ["Object.setPrototypeOf", o => Object.setPrototypeOf(o, other).twice()],
  ["Object.setPrototypeOf with null", o => { Object.setPrototypeOf(o, null); return "set"; }],
  ["Reflect.setPrototypeOf", o => Reflect.setPrototypeOf(o, other)],
  ["a store to __proto__", o => { o.__proto__ = other; return o.twice(); }],
  ["the prototype it has", o => Object.setPrototypeOf(o, Object.getPrototypeOf(o)) === o && Reflect.setPrototypeOf(o, Object.getPrototypeOf(o))],
  ["a number stored to __proto__", o => { o.__proto__ = 5; return "ignored"; }],
];
for (const [how, make] of makers) {
  for (const [what, operation] of operations) {
    const o = make();
    const born = Object.getPrototypeOf(o);
    attempt(how + ", " + what, () => operation(o));
    console.log("  afterwards:", Object.getPrototypeOf(o) === born, o.x);
  }
}
