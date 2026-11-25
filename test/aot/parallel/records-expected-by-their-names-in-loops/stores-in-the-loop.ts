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
function raise(text: string, others: () => unknown[]): string {
  const list: unknown[] = (JSON.parse(text) as unknown[]).concat(others());
  const copies: Copy[] = [];
  for (const item of list) {
    if (!isRecord(item))
      continue;
    try {
      item.price = (item.price as number) + (item.weight as number);
      item.crate = item.crate + "!";
    } catch {
      copies.length = 0;
    }
    copies.push({ crate: item.crate, weight: item.weight, price: item.price });
  }
  return copies.map(copy => String(copy.crate) + copy.price).join();
}
console.log(raise(plain, none), raise(plain, new Function("return [Object.freeze({ crate: 'f', weight: 1, price: 1 }), { crate: 'm', weight: 1, price: 1, more: 2 }]") as () => unknown[]));
