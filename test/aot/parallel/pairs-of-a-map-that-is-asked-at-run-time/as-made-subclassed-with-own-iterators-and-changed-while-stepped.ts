// STATISTIC: PairsOfMapsHandedOnInParts >= 6
// Pairs taken apart over Maps that are asked at run time: as made, with iterators of their own, subclasses, changed while stepped, left early, and entries that cannot be taken apart.
const log: string[] = [];
function sumPairs(map: Map<string, number>): string { let keys = "", sum = 0; for (const [key, value] of map) { keys += key; sum += value; } return keys + ":" + sum; }
function sumValues(map: Map<string, number>): number { let sum = 0; for (const [, value] of map) sum += value; return sum; }
function sumEntries(map: Map<string, number>): string { let out = ""; for (const [key, value] of map.entries()) out += key + "=" + value + ";"; return out; }
function growing(map: Map<string, number>): string { let out = ""; for (const [key, value] of map) { out += key; if (value < 3) map.set(key + "x", value + 2); if (value === 1) map.delete("c"); } return out; }
function early(map: Map<string, number>): string { for (const [key, value] of map) { if (value === 2) return key; } return "none"; }
function throwing(map: Map<string, number>): string { try { for (const [key, value] of map) { if (value === 2) throw new Error("at " + key); } } catch (error) { return (error as Error).message; } return "none"; }
(globalThis as any).handedOut = { sumPairs, sumValues, sumEntries, growing, early, throwing };
const make = () => new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
class Sub extends Map<string, number> { *[Symbol.iterator](): any { log.push("own"); yield ["s", 7]; yield ["t", 8]; } }
const own = make(); (own as any)[Symbol.iterator] = function* () { log.push("instance"); yield ["i", 5]; yield "xy"; yield { 0: "no", [Symbol.iterator]() { log.push("odd"); let n = 0; return { next: () => ({ done: n > 1, value: n++ ? 9 : "o" }), return() { log.push("odd closed"); return {}; } }; } }; };
const closes = make(); (closes as any)[Symbol.iterator] = function () { let n = 0; return { next: () => ({ done: false, value: n++ ? 5 : ["z", 1] }), return() { log.push("outer closed"); return {}; } }; };
const all: [string, () => unknown][] = [
  ["pairs", () => sumPairs(make())], ["values", () => sumValues(make())], ["entries", () => sumEntries(make())], ["growing", () => growing(make())], ["early", () => early(make())], ["throwing", () => throwing(make())],
  ["sub", () => sumPairs(new Sub([["q", 1]]))], ["sub entries", () => sumEntries(new Sub([["q", 1]]))], ["own", () => sumPairs(own)], ["own values", () => sumValues(own)],
  ["not iterable entry", () => { try { return sumPairs(closes); } catch (error) { return (error as Error).constructor.name; } }],
  ["empty", () => sumPairs(new Map())], ["odd values", () => sumPairs(new Map<any, any>([[1, "x"], [{}, null], [undefined, undefined]]))],
  ["no map", () => { try { return sumPairs([["l", 4], ["m", 5]] as any); } catch (error) { return (error as Error).constructor.name; } }],
  ["null", () => { try { return sumPairs(null as any); } catch (error) { return (error as Error).constructor.name; } }],
];
for (let round = 0; round < 3; round++) for (const [name, run] of all) console.log(name, String(run()), log.splice(0).join(","));
