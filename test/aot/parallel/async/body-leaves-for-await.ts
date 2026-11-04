type Item = { price: number; count: number; name: string };
const log: string[] = [];
function open(): unknown { return eval("1"); }
function items(bad: number): Item[] { const list: Item[] = []; for (let i = 0; i < 8; i++) list.push(i === bad ? ({ price: "7", count: 2, name: "bad" } as any) : { price: i, count: i & 3, name: "n" + i }); return list; }

async function* source(list: Item[]) { for (const item of list) { await null; yield item; } }
export async function drain(list: Item[], scale: number): Promise<unknown> {
  let sum: any = 0;
  for await (const item of source(list)) sum += item.price * scale + item.name.length;
  return sum;
}
(globalThis as any).drain = drain; open();
for (const bad of [-1, 0, 6]) console.log(bad, await drain(items(bad), 2));
console.log(await drain(items(-1), "2" as any));
