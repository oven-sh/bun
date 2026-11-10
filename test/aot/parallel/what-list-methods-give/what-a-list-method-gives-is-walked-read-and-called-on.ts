// The list that map, filter, slice and concat give is walked, measured, read by index, handed on to the next method and written on.
// STATISTIC: ResultsOfLibraryFunctionsHeldToRows >= 1
class Item { constructor(readonly weight: number, readonly name: string) {} heavy(): boolean { return this.weight > 2; } }
function make(rows: { w: number; n: string }[]): Item[] { return rows.map(row => new Item(row.w, row.n)); }
function weighed(rows: { w: number; n: string }[]): number { let sum = 0; for (const item of rows.map(row => new Item(row.w, row.n))) sum += item.weight; for (const item of rows.filter(row => row.w > 1)) sum += item.w; return sum; }
function total(items: Item[]): number { let sum = 0; for (const item of items) sum += item.weight; return sum; }
const rows = [{ w: 1, n: "a" }, { w: 2, n: "b" }, { w: 3, n: "c" }, { w: 4, n: "d" }];
const said: string[] = [];
for (let turn = 0; turn < 40; turn++) {
  said.length = 0;
  const items = make(rows), heavy = items.filter(item => item.heavy());
  said.push(String(total(items)), String(total(heavy)), String(items.length + heavy.length), items[1]!.name, String(items[9]), heavy.map(item => item.name).join(""));
  items.push(new Item(turn, "z")); items[0] = new Item(10, "y"); (items as any).note = "n"; said.push(String(total(items)), (items as any).note, String(items.reduce((sum, item) => sum + item.weight, 0)));
  said.push(String(weighed(rows)));
  heavy.length = 1; said.push(String(total(heavy)), String(heavy.map(item => item.weight * 2)[0]));
}
console.log(said.join("|")); export {};
