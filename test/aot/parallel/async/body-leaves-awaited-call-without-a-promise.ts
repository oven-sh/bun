type Item = { price: number; count: number; name: string };
const log: string[] = [];
function open(): unknown { return eval("1"); }
function items(bad: number): Item[] { const list: Item[] = []; for (let i = 0; i < 8; i++) list.push(i === bad ? ({ price: "7", count: 2, name: "bad" } as any) : { price: i, count: i & 3, name: "n" + i }); return list; }

export async function inner(list: Item[], from: number): Promise<number | string> {
  let sum: any = 0;
  for (let i = from; i < list.length; i++) sum += list[i].price;
  await null;
  for (let i = 0; i < from; i++) sum += list[i].count;
  return sum;
}
export async function outer(list: Item[]): Promise<string> {
  const first = await inner(list, 2);
  const second = await inner(list, 6);
  return first + "/" + second;
}
(globalThis as any).inner = inner; (globalThis as any).outer = outer; open();
for (const bad of [-1, 1, 4, 7]) console.log(bad, await outer(items(bad)));
