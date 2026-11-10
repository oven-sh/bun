// The table is declared a Map and is an instance of a subclass with a `get` of its own. The guard that it is a plain Map does not change in the loop, so it is hoisted with the lookup and before it:
// where it fails, the program never looks anything up in the table itself, and neither does the preheader. Only the last call, on a plain Map, does.
// STATISTIC: CollectionLookupsHoisted >= 1
// COUNT: operation:operationAOTMapGet <= 1
const list: number[] = JSON.parse("[1,2,3]");
let calls = 0;
class Counting extends Map<string, number> { get(key: string): number { calls++; return key.length; } }
function sum(list: number[], table: Map<string, number>, q: string): number { let s = 0; for (let i = 0; i < list.length; i++) s += (table.get(q) ?? 1) + list[i]; return s; }
(globalThis as any).kept = sum;
const left: string = JSON.parse('"left "'), right: string = JSON.parse('"right"');
for (let round = 0; round < 3; round++) console.log(sum(list, new Counting([["x", 1]]), left.repeat(20) + right.repeat(20)), calls);
console.log(sum(list, new Map([["a", 5]]), "a"));
