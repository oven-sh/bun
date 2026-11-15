type Copy = { crate: unknown; weight: unknown; price: unknown };
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function total(text: string, others: () => unknown[]): string {
  const list: unknown[] = (JSON.parse(text) as unknown[]).concat(others());
  const copies: Copy[] = [];
  let names = "";
  let sum = 0;
  for (const item of list) {
    if (!isRecord(item)) {
      names += "?";
      continue;
    }
    names += String(item.crate);
    sum += (item.weight as number) * (item.price as number);
    copies.push({ crate: item.crate, weight: item.weight, price: item.price });
  }
  return names + "|" + sum + "|" + copies.length;
}
const plain = '[{"crate":"a","weight":1,"price":2},{"crate":"b","weight":3,"price":4}]';
const none = new Function("return []") as () => unknown[];
console.log(total(plain, none));
function changed(text: string, change: (list: unknown[]) => void): string {
  const list = JSON.parse(text) as unknown[];
  change(list);
  const copies: Copy[] = [];
  let names = "";
  let sum = 0;
  for (const item of list) {
    if (!isRecord(item))
      continue;
    names += String(item.crate);
    sum += (item.weight as number) * (item.price as number);
    copies.push({ crate: item.crate, weight: item.weight, price: item.price });
  }
  return names + "|" + sum;
}
for (const body of ["delete list[0].weight", "list[0].more = 1", "Object.freeze(list[0])", "Object.defineProperty(list[0], 'price', { get() { return 100; } })", "Object.setPrototypeOf(list[0], { weight: 50 }); delete list[0].weight", "list[0].price = 'text'", "list[1] = Object.assign({}, list[0])"])
  console.log(changed(plain, new Function("list", body) as (list: unknown[]) => void));
