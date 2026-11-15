interface Checker { accepts(value: unknown): boolean }
function makeChecker(kind: string): Checker { const made: any = Object.create(null); made.accepts = (value: unknown) => typeof value === kind; return made; }
interface Customer { id: number; name: string; tags: string[]; owner: Customer | null }
type ShapeOfCustomer = { id: Checker; name: Checker; tags: Checker; owner: Checker };
const shape: ShapeOfCustomer = { id: makeChecker("number"), name: makeChecker("string"), tags: makeChecker("object"), owner: makeChecker("object") };
function makeCustomer(id: number, owner: Customer | null): Customer { return { id, name: "customer " + id, tags: ["a" + id, "b"], owner }; }

function weigh(customer: Customer): number {
  let sum = customer.id + customer.name.length;
  for (const tag of customer.tags) sum += tag.length;
  if (customer.owner !== null) sum += customer.owner.id;
  return sum;
}
let total = 0;
let last: Customer | null = null;
for (let i = 0; i < 2000; i++) { last = makeCustomer(i, i % 3 ? last : null); total += weigh(last); }
console.log(total, shape.id.accepts(1), shape.name.accepts(1));
