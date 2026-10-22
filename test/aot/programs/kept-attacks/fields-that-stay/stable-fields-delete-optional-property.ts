// An optional declared property is deleted, tested, read and stored again as in plain Bun, also where every construction fills it.
interface Options { name: string; limit?: number; label?: string }
class Holder { name: string = "n"; limit?: number = 1; label?: string = "l" }
function Build(this: Options) { this.name = "n"; this.limit = 1; this.label = "l"; }
const makers: [string, () => Options][] = [
  ["a class instance", () => new Holder()],
  ["a literal", () => ({ name: "n", limit: 1, label: "l" })],
  ["what a constructor function makes", () => new (Build as any)()],
];
const key = ["la", "bel"].join("");
for (const [how, make] of makers) {
  const o = make();
  console.log(how + ":", delete o.limit, "limit" in o, o.limit, Object.keys(o).join());
  console.log("  again:", delete o.limit, Object.hasOwn(o, "limit"));
  o.limit = 5;
  console.log("  stored again:", o.limit, Object.keys(o).join(), JSON.stringify(o));
  console.log("  Reflect:", Reflect.deleteProperty(o, "label"), delete (o as any)[key], o.label, Object.keys(o).join());
  const untyped: any = o;
  untyped.label = "late";
  console.log("  through any:", delete untyped.limit, JSON.stringify(untyped), Object.entries(untyped).join("|"));
}
