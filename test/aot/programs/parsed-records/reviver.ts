const leak = new Function("value", process.argv.length > 99 ? "" : "return value");
function parse(text: string, reviver?: any): any {
  return JSON.parse(text, reviver);
}
interface Money { amount: number; currency: string }
function format(money: Money): string {
  return `${money.amount} ${money.currency}`;
}
leak({ amount: 0, currency: "" } satisfies Money);
console.log(format({ amount: 1, currency: "USD" }));
const text = '{"price":{"amount":5,"currency":"EUR"},"list":[{"amount":1,"currency":"a"},{"amount":2,"currency":"b"}]}';
for (let round = 0; round < 3; round++) {
  const seen: string[] = [];
  const doubled = parse(text, function (this: any, key: string, value: any) {
    seen.push(`${key}:${typeof value}:${Object.keys(this).join("+")}`);
    return typeof value === "number" ? value * 2 : value;
  });
  console.log(seen.join(" "), format(doubled.price), doubled.list.map(format).join(), JSON.stringify(doubled));
  const dropped = parse(text, (key: string, value: any) => (key === "currency" ? undefined : value));
  console.log(format(dropped.price), Object.keys(dropped.price).join(), JSON.stringify(dropped));
  const replaced = parse(text, (key: string, value: any) => (key === "price" ? { currency: "X", amount: 0, more: 1 } : value));
  console.log(format(replaced.price), JSON.stringify(replaced));
  for (const notCallable of [undefined, null, 1, "f", {}, []] as any[]) {
    const value = parse(text, notCallable);
    console.log(format(value.price), value.list.map(format).join());
  }
}
export {};
