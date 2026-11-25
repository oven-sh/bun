interface Checker { accepts(value: unknown): boolean }
function makeChecker(kind: string): Checker { const made: any = Object.create(null); made.accepts = (value: unknown) => typeof value === kind; return made; }
interface Customer { id: number; name: string; tags: string[]; owner: Customer | null }
type ShapeOfCustomer = { id: Checker; name: Checker; tags: Checker; owner: Checker };
const shape: ShapeOfCustomer = { id: makeChecker("number"), name: makeChecker("string"), tags: makeChecker("object"), owner: makeChecker("object") };
function makeCustomer(id: number, owner: Customer | null): Customer { return { id, name: "customer " + id, tags: ["a" + id, "b"], owner }; }

function describe(holder: { id: unknown; name: unknown; tags: unknown; owner: unknown }): string {
  const { id, name, tags, owner } = holder as Customer;
  return typeof id + " " + typeof name + " " + (Array.isArray(tags) ? tags.length : "no list") + " " + (owner === null ? "nobody" : typeof owner);
}
const seen = new Map<string, number>();
for (let i = 0; i < 2000; i++) {
  const text = describe(i % 5 === 4 ? shape : makeCustomer(i, null));
  seen.set(text, (seen.get(text) ?? 0) + 1);
}
console.log([...seen].sort().join(" | "));
