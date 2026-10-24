// The own keys of an object born in a .ts file come in the order in which the properties were created, as in plain Bun, whatever order the type declares them in.
interface Options { a?: number; b?: number; c?: number; d: number }
class Holder { d: number = 4; a?: number; b?: number; c?: number }
class Late { declare a?: number; declare b?: number; d: number = 4; }
function Build(this: Options) { this.d = 4; }
const show = (label: string, o: object) => {
  const inLoop: string[] = [];
  for (const name in o) inLoop.push(name);
  console.log(label + ":", Object.keys(o).join(), "|", inLoop.join(), "|", JSON.stringify(o), "|", Object.entries({ ...o }).join(";"), "|", Reflect.ownKeys(o).join());
};
const makers: [string, () => Options][] = [
  ["a literal", () => ({ d: 4 })],
  ["a literal in another order", () => ({ c: 3, d: 4, a: 1 })],
  ["a class instance", () => new Holder()],
  ["an instance of a class that only declares them", () => new Late()],
  ["what a constructor function makes", () => new (Build as any)()],
];
for (const [how, make] of makers) {
  const o = make();
  show(how, o);
  o.c = 3; o.a = 1;
  show("  c, then a", o);
  o.b = 2;
  show("  then b", o);
  delete o.a;
  show("  without a", o);
  o.a = 10;
  show("  a again", o);
  (o as any).z = 26; delete o.c; o.c = 30;
  show("  a new one, and c again", o);
}
