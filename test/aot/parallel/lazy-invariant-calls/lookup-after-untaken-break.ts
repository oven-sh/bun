// A `break` comes before the lookups, so they may not be hoisted. The first iteration that gets to them makes them, and the others take their results.
// STATISTIC: ResultsCarriedAroundLoops >= 2
const list: number[] = JSON.parse("[1,2,3,4,5,6,7,8]");
function sum(list: number[], table: Map<string, number>, members: Set<string>, q: string, stop: number): number { let s = 0; for (let i = 0; i < list.length; i++) { if (list[i] === stop) break; s += (table.get(q) ?? 1) * list[i] + (members.has(q) ? 100 : 0); } return s; }
(globalThis as any).kept = sum;
for (const q of JSON.parse('["a","b","c"]')) for (const stop of [0, 1, 5]) console.log(sum(list, new Map([["a", 5], ["b", NaN]]), new Set(["b"]), q, stop));
