type Item = { tag: string };
type Holder = { row?: Row; note?: string };
type Row = { id: number; extra?: Extra; other?: string };
type Extra = { label: string; more?: number };
const printed: string[] = [];
async function soon<T>(value: T): Promise<T> { await null; return value; }
function plain(id: number): Row { return { id }; }
function whole(id: number, label: string): Row { return { id, extra: { label } }; }
function blank(id: number): Row { return { id, extra: undefined }; }
function deferred(id: number, label: string): Row { return { id, get extra() { return { label }; } }; }
function deferredBoth(id: number, label: string): Row { let stored: Extra | undefined = { label }; return { id, get extra() { return stored; }, set extra(next) { stored = next; } }; }
function holding(row?: Row): Holder { return row ? { row } : { note: "n" }; }
const pile: Holder[] = []; for (let i = 0; i < 40; i++) pile.push(holding(i & 1 ? plain(i) : deferredBoth(i, "p" + i)));
(globalThis as any).pile = pile;
async function visit(holders: Holder[], batches: Item[][]) {
  const picked = holders[0]?.row;
  const found = picked?.extra;
  await null;
  for (const batch of batches) printed.push(String(batch.filter(item => item.tag === found?.label).length));
}
(globalThis as any).extra = visit;
const holders: Holder[] = [holding(deferredBoth(1, "b"))];
const batches: Item[][] = [[{ tag: "a" }, { tag: "b" }], [], [{ tag: "c" }]];
await visit(holders, batches);
(globalThis as any).afterwards?.();
await visit(holders, batches);
for (const item of pile.slice(0, 4)) await visit([item], batches);
console.log(printed.join(" "));
