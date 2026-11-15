// A lookup under a key that does not change in the loop hashes the key, and flattens it if it is a rope. The first iteration leaves before the lookup.
// STATISTIC: CollectionLookupsHoisted = 0
const list: string[] = JSON.parse('["stop","a","b"]');
function sum(list: string[], table: Map<string, number>, q: string, stop: string): number { let n = 0; for (let i = 0; i < list.length; i++) { if (list[i] === stop) break; n += table.get(q) ?? 1; } return n; }
function count(list: string[], table: Set<string>, q: string, stop: string): number { let n = 0; for (let i = 0; i < list.length; i++) { if (list[i] === stop) break; if (table.has(q)) n++; } return n; }
(globalThis as any).kept = [sum, count];
const q: string = JSON.parse('"a"');
for (const stop of ["stop", "b", "none"]) console.log(sum(list, new Map([["a", 5]]), q, stop), count(list, new Set(["a"]), q, stop));
