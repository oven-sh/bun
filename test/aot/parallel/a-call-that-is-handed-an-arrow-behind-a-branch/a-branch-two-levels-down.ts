const unseen = <T>(x: T): T => [x][JSON.parse("0")];
const notes: string[] = [];
function size(table: Map<string, number>): number { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return table.size + work - 1; }
function left(table: Map<string, number>): undefined { notes.push("left" + table.size); return undefined; }
function right(table: Map<string, number>): undefined { notes.push("right" + table.size); return undefined; }
function walk(table: Map<string, number>, seen: string[]): number {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let total = 0;
  table.forEach((value, key) => { seen.push(key); total += value; }, [String(size(table) > 1 ? left(table) : right(table))]);
  return total;
}
let sum = 0; const seen: string[] = [];
for (let turn = 0; turn < 300; turn++) { const table = unseen(new Map([["a", 1], ["b", 2]])); sum += walk(table, seen); const one = unseen(new Map([["c", 3]])); sum += walk(one, seen); }
console.log(sum, seen.length, seen.slice(0, 5).join(), notes.length, notes.slice(0, 6).join());
