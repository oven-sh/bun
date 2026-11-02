// The keys that `for (key in object)` hands out are compared with names that a caller hands in, each one of a few texts that the program spells. The objects come from literals, classes, JSON, a proxy, a list, a prototype chain, and names put together while the program runs.
function hasOnly(value: Record<string, unknown>, first: string, second: string, third: string): boolean {
  for (const key in value) if (key !== first && key !== second && key !== third) return false;
  return true;
}
function countOf(value: object, name: string): number {
  let count = 0;
  for (const key in value) if (key === name) count++;
  return count;
}
function firstOther(value: object, first: string, second: string): string {
  for (const key in value) {
    if (key == first || second == key) continue;
    return key;
  }
  return "";
}
class Order {
  customer = 1;
  items = 2;
  coupon = 3;
}
class Late extends Order {
  sku = 4;
}
const made: Record<string, unknown> = {};
for (const part of ["cust", "it", "cou"]) made[part + { cust: "omer", it: "ems", cou: "pon" }[part]!] = part;
const grown: Record<string, unknown> = { customer: 1 };
grown["it" + "ems".slice(0)] = 2;
delete grown.customer;
grown.customer = 3;
const objects: [string, any][] = [
  ["literal", { customer: 1, items: 2, coupon: 3 }],
  ["other order", { coupon: 1, customer: 2, items: 3 }],
  ["fewer", { items: 1 }],
  ["empty", {}],
  ["one more", { customer: 1, items: 2, coupon: 3, sku: 4 }],
  ["near", { customers: 1, item: 2, Coupon: 3 }],
  ["empty name", { "": 1, customer: 2 }],
  ["class", new Order()],
  ["heir", new Late()],
  ["parsed", JSON.parse('{"customer":{"id":1},"items":[],"coupon":"TENOFF"}')],
  ["parsed with more", JSON.parse('{"customer":1,"quantity":2}')],
  ["escaped", JSON.parse('{"\\u0063ustomer":1,"items":2}')],
  ["made", made],
  ["grown", grown],
  ["inherits", Object.create({ coupon: 1 }, { customer: { value: 1, enumerable: true }, items: { value: 2, enumerable: false } })],
  ["proxy", new Proxy({ customer: 1, items: 2 }, { ownKeys: () => ["it" + "ems", "customer"] })],
  ["list", ["a", "b"]],
  ["indices", { 0: "a", customer: 1, 1: "b" }],
  ["text", Object("ab")],
  ["wide", { "customér": 1, "世": 2 }],
  ["null prototype", Object.assign(Object.create(null), { items: 1, coupon: 2 })],
];
const lines: string[] = [];
for (let round = 0; round < 40; round++) {
  const line: string[] = [];
  for (const [label, object] of objects) {
    line.push(
      label,
      String(hasOnly(object, "customer", "items", "coupon")),
      String(hasOnly(object, "id", "name", "email")),
      String(hasOnly(object, "sku", "quantity", "0")),
      String(hasOnly(object, "", "1", "customer")),
      String(countOf(object, "customer") + countOf(object, "items") * 10 + countOf(object, "0") * 100 + countOf(object, "") * 1000),
      firstOther(object, "customer", "items"),
      firstOther(object, "coupon", "0"),
    );
  }
  if (round === 0 || round === 39) lines.push(line.join(" "));
}
console.log(lines[0]!.replaceAll(" true", " T").replaceAll(" false", " F"));
console.log(lines[0] === lines[1]);
