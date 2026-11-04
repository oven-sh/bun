type Item = { price: number; count: number; name: string };
const log: string[] = [];
function open(): unknown { return eval("1"); }
function items(bad: number): Item[] { const list: Item[] = []; for (let i = 0; i < 8; i++) list.push(i === bad ? ({ price: "7", count: 2, name: "bad" } as any) : { price: i, count: i & 3, name: "n" + i }); return list; }

export async function guarded(list: Item[], at: number): Promise<string> {
  let seen = 0;
  try {
    await null;
    for (let i = 0; i < list.length; i++) {
      seen += list[i].price;
      if (i === at) (list[i] as any).missing.deep;
      await undefined;
    }
    return "done " + seen;
  } catch (error) {
    await null;
    return "caught " + (error as Error).constructor.name + " " + seen;
  } finally {
    log.push("finally " + seen);
  }
}
(globalThis as any).guarded = guarded; open();
for (const [bad, at] of [[-1, -1], [1, -1], [1, 4], [5, 2], [-1, 0]]) console.log(bad, at, await guarded(items(bad), at));
console.log(log.join(","));
