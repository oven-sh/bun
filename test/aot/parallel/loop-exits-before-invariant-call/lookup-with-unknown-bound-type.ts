// Nothing proves that `n` is a number. The specialized loop holds its counter against an integer bound of its own, and the hoisted lookups go after that test.
// STATISTIC: CollectionLookupsHoisted >= 2
function sum(table: Map<string, number>, members: Set<string>, q: string, n: number): number { let s = 0; for (let i = 0; i < n; i++) s += (table.get(q) ?? 1) + (members.has(q) ? 10 : 0) + i; return s; }
(globalThis as any).kept = sum;
const q: string = JSON.parse('"a"');
for (const n of JSON.parse('[8, 0, -1, 2.5, "3", null]')) console.log(sum(new Map([["a", 5]]), new Set(["a"]), q, n));
