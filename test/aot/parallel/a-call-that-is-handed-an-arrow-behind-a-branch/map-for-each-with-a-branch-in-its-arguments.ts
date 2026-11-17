const unseen = <T>(x: T): T => [x][JSON.parse("0")];
function size(table: Map<string, number>): number { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return table.size + work - 1; }
function walk(table: Map<string, number>, seen: string[]): number {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let total = 0;
  table.forEach((value, key) => { seen.push(key); total += value; }, size(table) > 1 ? { tag: "many" } : { tag: "few" });
  return total;
}
function walkReturned(table: Map<string, number>, seen: string[]): void {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return table.forEach((value, key) => { seen.push(key + value); }, table.get("a") ?? table.get("b"));
}
function walkSet(items: Set<number>, seen: string[]): void {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return items.forEach((value) => { seen.push("s" + value); }, items.has(1) ? 1 : 2);
}
let sum = 0; const seen: string[] = [];
for (let turn = 0; turn < 300; turn++) { const table = unseen(new Map([["a", 1], ["b", 2]])); sum += walk(table, seen); walkReturned(table, seen); walkSet(unseen(new Set([1, 2, 3])), seen); }
console.log(sum, seen.length, seen.slice(0, 7).join());
