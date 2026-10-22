// Plain objects that hold plain objects, and arrays of plain objects, are read through record types: each stays the same object, a cycle and a shared child come out right, a member of the wrong kind throws where typed code reads it, and untyped code may store anything into any of them afterwards.
type Customer = { id: number; name: string };
type Item = { sku: string; quantity: number };
type Order = { customer: Customer; items: Item[]; coupon?: string };
type Node_ = { n: number; next: Node_ | null };

function makeOrder(i: number): Order {
  return { customer: { id: i, name: "made" }, items: [{ sku: "m", quantity: i }], coupon: "C" };
}
function makeNode(n: number): Node_ {
  return { n, next: null };
}
function weigh(order: Order): number {
  let sum = order.customer.id + order.customer.name.length;
  for (const item of order.items) sum += item.sku.length + item.quantity;
  return sum + (order.coupon === undefined ? 0 : order.coupon.length);
}
function walk(node: Node_, steps: number): number {
  let sum = 0;
  let at: Node_ | null = node;
  for (let i = 0; i < steps && at !== null; i++) {
    sum += at.n;
    at = at.next;
  }
  return sum;
}
function grow(i: number): any {
  return JSON.parse('{"customer":{"id":' + i + ',"name":"name ' + i + '"},"items":[{"sku":"a' + i + '","quantity":' + i + '},{"sku":"b","quantity":2}]}');
}
function attempt(action: () => unknown): string {
  try {
    return String(action());
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

console.log(weigh(makeOrder(1)), walk(makeNode(2), 1));
let sum = 0;
const kept: any[] = [];
for (let i = 0; i < 2000; i++) {
  const plain = grow(i);
  const customer = plain.customer;
  const item = plain.items[0];
  kept.push(plain);
  sum += weigh(plain as Order);
  if (plain.customer !== customer || plain.items[0] !== item) console.log("not the same object", i);
}
console.log(sum);
console.log(JSON.stringify(kept[7]), Object.keys(kept[7].customer).join());

const shared: any = { id: 9 };
shared.name = "shared";
const left: any = { customer: shared };
left.items = [];
const right: any = { customer: shared };
right.items = [];
console.log(weigh(left as Order), weigh(right as Order), left.customer === right.customer);

const a: any = { n: 1 };
const b: any = { n: 2 };
a.next = b;
b.next = a;
console.log(walk(a as Node_, 5), a.next.next === a);

const badParent: any = { customer: null };
const goodChild: any = { id: 3 };
goodChild.name = "child";
badParent.customer = goodChild;
badParent.items = 7;
console.log(attempt(() => weigh(badParent as Order)), goodChild.id, goodChild.name, JSON.stringify(badParent));
console.log(attempt(() => { goodChild.id = "now text"; return goodChild.id; }));

const badChild: any = { customer: null };
const wrong: any = { id: "text" };
wrong.name = "wrong";
badChild.customer = wrong;
badChild.items = [];
console.log(attempt(() => weigh(badChild as Order)), JSON.stringify(badChild));

const mixed = grow(5);
mixed.items.push({ sku: 1, quantity: "x" });
console.log(attempt(() => weigh(mixed as Order)), JSON.stringify(mixed.items));

type Strict = { customer: Customer; items: number[] };
function makeStrict(i: number): Strict {
  return { customer: { id: i, name: "made" }, items: [i] };
}
function weighStrict(strict: Strict): number {
  return strict.items.length;
}
console.log(weighStrict(makeStrict(1)));
for (let i = 0; i < 100; i++) {
  const fits: any = { customer: null };
  const child: any = { id: i };
  child.name = "fits";
  fits.customer = child;
  fits.items = [i];
  weighStrict(fits as Strict);
}
const refused: any = { customer: null };
const untouched: any = { id: 1 };
untouched.name = "untouched";
refused.customer = untouched;
refused.items = 7;
console.log(attempt(() => weighStrict(refused as Strict)));
console.log(attempt(() => { untouched.id = "still plain"; return untouched.id; }));
