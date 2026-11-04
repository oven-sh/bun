type Item = { price: number; count: number; name: string };
const log: string[] = [];
function open(): unknown { return eval("1"); }
function items(bad: number): Item[] { const list: Item[] = []; for (let i = 0; i < 8; i++) list.push(i === bad ? ({ price: "7", count: 2, name: "bad" } as any) : { price: i, count: i & 3, name: "n" + i }); return list; }

export async function strict(list: Item[], late: boolean): Promise<number> {
  let sum = 0;
  if (late) await null;
  for (let i = 0; i < list.length; i++) {
    const price = list[i].price;
    if (typeof price !== "number") throw new TypeError("price " + i);
    sum += price;
  }
  await null;
  return sum;
}
(globalThis as any).strict = strict; open();
for (const bad of [-1, 3]) for (const late of [false, true]) console.log(bad, late, await strict(items(bad), late).then(v => "ok " + v, e => "no " + e.message));
