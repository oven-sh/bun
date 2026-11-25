// The program's own objects hold a Set under `items`, a Map under `pairs`, a text under `words`. What arrives holds every other kind there: it is made under names that are put together at run time, so that no object in sight has them.
function* made(): Generator<unknown> { yield 1; yield [2, 3]; }
class Odd extends Set<unknown> { *[Symbol.iterator](): any { yield "odd"; } }
const own = new Set<unknown>([1]); (own as any)[Symbol.iterator] = function* () { yield "own"; };
const kept = { items: new Set<unknown>([1, 2, 3]), pairs: new Map<unknown, unknown>([["a", 1], ["b", 2]]), words: "ab\u{1F600}" };
const names = ["it" + "ems".slice(0), "pa" + "irs".slice(0), "wo" + "rds".slice(0)].map(name => name.split("").join(""));
function holding(items: unknown, pairs: unknown, words: unknown): unknown { const holder: any = {}; holder[names[0]] = items; holder[names[1]] = pairs; holder[names[2]] = words; return holder; }
(globalThis as any).shelf = { all: [kept,
  holding([4, 5], [["x", 9]], ["w", "v"]),
  holding("st", new Set([[1, 2]]), new Set(["q"])),
  holding(new Map([[1, 2]]), new Map(), ""),
  holding(new Odd([5]), [[1, 2]].values(), new Map([["m", 1]]).keys()),
  holding(own, new Map([[{}, []]]).entries(), [, "hole"]),
  holding(new Set(), [], new Uint8Array([3, 4])),
  holding(new Uint8Array([7]), new Map([["z", 26]]), "z")] };
const shelf: any = (globalThis as any).shelf;
function ofItems(holder: any): string { let text = ""; for (const item of holder.items) text += String(item) + ";"; return text; }
function firstOfItems(holder: any): string { for (const item of holder.items) return String(item); return "empty"; }
function throwsInItems(holder: any): string { try { for (const item of holder.items) throw new RangeError(String(item)); return "empty"; } catch (error) { return (error as Error).message; } }
function ofPairs(holder: any): string { let text = ""; for (const [key, value] of holder.pairs) text += String(key) + "=" + String(value) + ";"; return text; }
function ofWords(holder: any): string { let text = ""; for (const word of holder.words) text += String(word) + ";"; return text; }
function ofValues(holder: any): string { if (typeof holder.pairs.values !== "function") return "none"; let text = ""; for (const value of holder.pairs.values()) text += String(value) + ";"; return text; }
function ofKeys(holder: any): string { if (typeof holder.pairs.keys !== "function") return "none"; let text = ""; for (const key of holder.pairs.keys()) { text += String(key) + ";"; if (text.length > 12) break; } return text; }
function spread(holder: any): string { return JSON.stringify([0, ...holder.items, 9]); }
function pattern(holder: any): string { let text = ""; for (let round = 0; round < 2; round++) { const [first, second] = holder.items; text += String(first) + "," + String(second) + ";"; } return text; }
function grows(holder: any): string { let turns = 0; for (const item of holder.items) { if (++turns > 5) break; if (typeof holder.items.add === "function") holder.items.add(turns + 100); else if (typeof holder.items.push === "function") holder.items.push(item); } return String(turns); }
function lacks(holder: any): string { try { for (const item of holder.items) return String(item); return "empty"; } catch (error) { return (error as Error).constructor.name; } }
let out = "";
for (let round = 0; round < 3; round++) for (const holder of shelf.all) out += [ofItems(holder), firstOfItems(holder), throwsInItems(holder), ofPairs(holder), ofWords(holder), ofValues(holder), ofKeys(holder), spread(holder), pattern(holder)].join(" ") + "\n";
out += shelf.all.slice(0, 3).map(grows).join() + "\n";
console.log(out + [lacks(holding(undefined, 0, 0)), lacks(holding(null, 0, 0)), lacks(holding(5, 0, 0)), lacks(holding({}, 0, 0)), lacks(holding(made(), 0, 0))].join());
