class Plain extends Map<string, number> {}
class Own extends Map<string, number> { values(): any { return ["of the class"][Symbol.iterator](); } }
class Counts extends Map<string, number> { calls = 0; keys() { this.calls++; return super.keys(); } }
class Members extends Set<number> { *values(): any { yield "generated"; } }
function ofMap(map: Map<string, number>) { const seen: unknown[] = []; for (const value of map.values()) seen.push(value); for (const key of map.keys()) seen.push(key); return seen.join(); }
function ofSet(set: Set<number>) { const seen: unknown[] = []; for (const value of set.values()) seen.push(value); for (const key of set.keys()) seen.push(key); for (const pair of set.entries()) seen.push(pair.join("=")); return seen.join(); }
const entries: [string, number][] = [["a", 1], ["b", 2]];
const counts = new Counts(entries);
console.log(ofMap(new Map(entries)), ofMap(new Plain(entries)), ofMap(new Own(entries)), ofMap(counts), counts.calls);
console.log(ofSet(new Set([1, 2])), ofSet(new Members([1, 2])));
const plain = new Plain(entries); for (const value of plain.values()) console.log(value);
const own = new Own(entries); for (const value of own.values()) console.log(value);
