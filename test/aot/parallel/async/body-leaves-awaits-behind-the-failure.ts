type Item = { price: number; count: number; name: string };
const log: string[] = [];
function open(): unknown { return eval("1"); }
function items(bad: number): Item[] { const list: Item[] = []; for (let i = 0; i < 8; i++) list.push(i === bad ? ({ price: "7", count: 2, name: "bad" } as any) : { price: i, count: i & 3, name: "n" + i }); return list; }

export async function walk(list: Item[], tag: string): Promise<string> {
  let text = tag;
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    text += ":" + (item.price + 1);
    log.push(tag + i);
    await null;
    text += item.name.length;
    if (i & 1) await Promise.resolve(i);
  }
  return text;
}
(globalThis as any).walk = walk; open();
const both = await Promise.all([walk(items(2), "a"), walk(items(-1), "b"), walk(items(7), "c")]);
console.log(both.join(" | ")); console.log(log.join(","));
