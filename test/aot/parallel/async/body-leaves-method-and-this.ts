type Item = { price: number; count: number; name: string };
const log: string[] = [];
function open(): unknown { return eval("1"); }
function items(bad: number): Item[] { const list: Item[] = []; for (let i = 0; i < 8; i++) list.push(i === bad ? ({ price: "7", count: 2, name: "bad" } as any) : { price: i, count: i & 3, name: "n" + i }); return list; }

export class Basket {
  total = 0;
  constructor(public list: Item[], public factor: number) {}
  async sum(extra: number): Promise<unknown> {
    await null;
    for (const item of this.list) { this.total += item.price * this.factor; if (item.count === 3) await null; }
    return (this.total as any) + extra;
  }
}
(globalThis as any).Basket = Basket; open();
for (const bad of [-1, 0, 5]) { const basket = new Basket(items(bad), 2); console.log(bad, await basket.sum(1), basket.total); }
const odd = new Basket(items(-1), "3" as any); console.log(await odd.sum(1), odd.total);
