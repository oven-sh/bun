// `delete` of a required declared property of an object born in a .ts file throws a TypeError, however it is spelled, and leaves the object as it was. Plain Bun deletes.
// Columns: fields wide kinds types
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", (e as Error).constructor.name); }
}
interface Point { x: number; y: number }
class Pair { x: number = 1; y: number = 2 }
function Made(this: Point) { this.x = 1; this.y = 2; }
const makeInferred = () => ({ x: 1, y: 2 });
const makers: [string, () => any][] = [
  ["a class instance", () => new Pair()],
  ["an annotated literal", () => { const point: Point = { x: 1, y: 2 }; return point; }],
  ["a literal without an annotation", makeInferred],
  ["what a constructor function makes", () => new (Made as any)()],
];
const key = ["x"].join("");
function deleteThroughView(o: { x?: number }) { return delete o.x; }
for (const [how, make] of makers) {
  const o = make();
  attempt(how + ", through a type that makes it optional", () => deleteThroughView(o));
  attempt(how + ", through any", () => delete o.x);
  attempt(how + ", under a computed key", () => delete o[key]);
  attempt(how + ", Reflect.deleteProperty", () => Reflect.deleteProperty(o, "x"));
  console.log(how + ", afterwards:", JSON.stringify(o), "x" in o);
}
