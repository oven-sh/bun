type Item = { price: number; count: number; name: string };
const log: string[] = [];
function open(): unknown { return eval("1"); }
function items(bad: number): Item[] { const list: Item[] = []; for (let i = 0; i < 8; i++) list.push(i === bad ? ({ price: "7", count: 2, name: "bad" } as any) : { price: i, count: i & 3, name: "n" + i }); return list; }

export async function collect(list: Item[], step: number): Promise<string> {
  const readers: (() => string)[] = [];
  for (let i = 0; i < list.length; i += step) {
    const price = list[i].price;
    let seen = price + 1;
    readers.push(() => i + "=" + seen++);
    if (i === 2) await null;
  }
  await null;
  return readers.map(read => read() + read()).join(",");
}
(globalThis as any).collect = collect; open();
for (const bad of [-1, 2, 4]) console.log(bad, await collect(items(bad), 2));
console.log(await collect(items(-1), "3" as any).catch(e => e.constructor.name));
