interface Checker { accepts(value: unknown): boolean }
function makeChecker(kind: string): Checker { const made: any = Object.create(null); made.accepts = (value: unknown) => typeof value === kind; return made; }
interface Customer { id: number; name: string; tags: string[]; owner: Customer | null }
type ShapeOfCustomer = { id: Checker; name: Checker; tags: Checker; owner: Checker };
const shape: ShapeOfCustomer = { id: makeChecker("number"), name: makeChecker("string"), tags: makeChecker("object"), owner: makeChecker("object") };
function makeCustomer(id: number, owner: Customer | null): Customer { return { id, name: "customer " + id, tags: ["a" + id, "b"], owner }; }

function idOf(customer: Customer): number { return customer.id; }
let reads = 0, sum = 0;
for (let i = 0; i < 2000; i++) {
  const customer = makeCustomer(i, null);
  if (i % 100 === 99) Object.defineProperty(customer, "id", { get() { reads++; return 1000000; }, configurable: true });
  if (i % 100 === 49) delete (customer as any).id;
  const id = idOf(customer);
  sum += id === undefined ? 3 : id;
}
console.log(sum, reads);
