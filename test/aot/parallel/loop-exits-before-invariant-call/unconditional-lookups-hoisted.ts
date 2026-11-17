// Nothing leaves the loop before the lookups, so they are hoisted, after the test that the loop iterates at all.
// STATISTIC: CollectionLookupsHoisted >= 2
const list: number[] = JSON.parse("[1,2,3,4,5,6,7,8]");
function sum(list: number[], table: Map<string, number>, members: Set<string>, q: string): number { let s = 0; for (let i = 0; i < list.length; i++) s += (table.get(q) ?? 1) + (members.has(q) ? 10 : 0) + list[i]; return s; }
(globalThis as any).kept = sum;
const q: string = JSON.parse('"a"');
console.log(sum(list, new Map([["a", 5]]), new Set(["a"]), q), sum(list, new Map([["b", 5]]), new Set(["b"]), q), sum([], new Map([["a", 5]]), new Set(["a"]), q));
