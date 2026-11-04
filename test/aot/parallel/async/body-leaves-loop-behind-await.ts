type Item = { price: number; count: number; name: string };
const log: string[] = [];
function open(): unknown { return eval("1"); }
function items(bad: number): Item[] { const list: Item[] = []; for (let i = 0; i < 8; i++) list.push(i === bad ? ({ price: "7", count: 2, name: "bad" } as any) : { price: i, count: i & 3, name: "n" + i }); return list; }

export async function worth(list: Item[], rounds: number): Promise<unknown> {
  await null;
  let total: any = 0;
  for (let round = 0; round < rounds; round++) for (let i = 0; i < list.length; i++) total += list[i].price * list[i].count + list[i].name.length;
  return total;
}
(globalThis as any).worth = worth; open();
for (const bad of [-1, 0, 3, 7]) console.log(bad, await worth(items(bad), 3));
