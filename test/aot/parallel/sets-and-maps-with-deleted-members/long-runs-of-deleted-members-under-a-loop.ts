// A compiled for-of passes deleted members by in line; a long run it hands over to its stub, and the stub hands a longer one over to the table, which scans.
// Runs of every length from 1 to 110 begin at the front, behind a head and further back; some end with the table. No live member may be passed by, none seen twice, and the walk may not end early.
// The collections are typed (the step stands in line) and of unknown type (the stub is entered at once). All the work stands in functions.
// A Set<number | Box> that holds boxes alone has keys of half a word where its site looks for whole words: so every deleted entry goes to the stub's loop over HALF words; a set of unknown type that holds numbers goes to the one over whole words.
declare const process: any; export {};
type Runs = [number, number][];
function told(list: unknown[]): string { let h = 7; for (let i = 0; i < list.length; i++) { const s = String(list[i]); for (let j = 0; j < s.length; j++) h = (h * 31 + s.charCodeAt(j)) % 1000003; h = (h * 31 + 44) % 1000003; } return list.length + ":" + h; }
function isGone(i: number, runs: Runs): boolean { for (const [from, length] of runs) if (i >= from && i < from + length) return true; return false; }
function numbersWithout(size: number, runs: Runs): Set<number> { const s = new Set<number>(); for (let i = 0; i < size; i++) s.add(i * 3); for (let i = 0; i < size; i++) if (isGone(i, runs)) s.delete(i * 3); return s; }
function textsWithout(size: number, runs: Runs): Set<string> { const s = new Set<string>(); for (let i = 0; i < size; i++) s.add("m" + i); for (let i = 0; i < size; i++) if (isGone(i, runs)) s.delete("m" + i); return s; }
function pairsWithout(size: number, runs: Runs): Map<number, string> { const m = new Map<number, string>(); for (let i = 0; i < size; i++) m.set(i * 3, "v" + i); for (let i = 0; i < size; i++) if (isGone(i, runs)) m.delete(i * 3); return m; }
function overNumbers(s: Set<number>): number[] { const out: number[] = []; for (const m of s) out.push(m); return out; }
function overTexts(s: Set<string>): string[] { const out: string[] = []; for (const m of s) out.push(m); return out; }
function overPairs(m: Map<number, string>): unknown[] { const out: unknown[] = []; for (const [k, v] of m) { out.push(k); out.push(v); } return out; }
function overKeys(m: Map<number, string>): number[] { const out: number[] = []; for (const k of m.keys()) out.push(k); return out; }
function overValues(m: Map<number, string>): string[] { const out: string[] = []; for (const v of m.values()) out.push(v); return out; }
class Box { constructor(readonly n: number) {} }
function boxesWithout(size: number, runs: Runs): Set<number | Box> { const s = new Set<number | Box>(), all: Box[] = []; for (let i = 0; i < size; i++) { const b = new Box(i * 3); all.push(b); s.add(b); } for (let i = 0; i < size; i++) if (isGone(i, runs)) s.delete(all[i]!); return s; }
function overBoxes(s: Set<number | Box>): number[] { const out: number[] = []; for (const m of s) out.push(typeof m === "number" ? -1 - m : m.n); return out; }
function overUnknown(s: any): unknown[] { const out: unknown[] = []; for (const m of s) out.push(m); return out; }
function ways(size: number, runs: Runs): string {
  const numbers: number[] = [], texts: string[] = [], pairs: unknown[] = [], values: string[] = [];
  for (let i = 0; i < size; i++) if (!isGone(i, runs)) { numbers.push(i * 3); texts.push("m" + i); pairs.push(i * 3); pairs.push("v" + i); values.push("v" + i); }
  const a = numbersWithout(size, runs), b = textsWithout(size, runs), c = pairsWithout(size, runs);
  const ok = told(overNumbers(a)) === told(numbers) && told(overTexts(b)) === told(texts) && told(overPairs(c)) === told(pairs) && told(overKeys(c)) === told(numbers) && told(overValues(c)) === told(values)
    && told(overBoxes(boxesWithout(size, runs))) === told(numbers) && told(overUnknown(a)) === told(numbers) && told(overUnknown(b)) === told(texts) && told(overUnknown(c.keys())) === told(numbers) && a.size === numbers.length;
  return ok ? told(numbers) : "WRONG(" + told(numbers) + " | " + [told(overNumbers(a)), told(overTexts(b)), told(overPairs(c)), told(overKeys(c)), told(overValues(c)), told(overUnknown(a)), told(overUnknown(b)), told(overBoxes(boxesWithout(size, runs)))].join(" ") + ")";
}
function second(s: Set<number>): number { let i = 0; for (const m of s) if (i++ === 1) return m; return -1; }
function first(s: Set<number>): number { for (const m of s) return m; return -1; }
function takenBehindTheHead(size: number): number[] { const s = new Set<number>(), out: number[] = []; for (let i = 0; i < size; i++) s.add(i); for (let m = second(s); m >= 0; m = second(s)) { out.push(m); s.delete(m); } out.push(s.size); return out; }
function takenFromTheFront(size: number): number[] { const s = new Set<number>(), out: number[] = []; for (let i = 0; i < size; i++) s.add(i); for (let m = first(s); m >= 0; m = first(s)) { out.push(m); s.delete(m); if (m < size && m % 50 === 7) s.add(size + m); } out.push(s.size); return out; }
function deletedAheadOfTheWalk(): number[] {
  const s = new Set<number>(), seen: number[] = []; for (let i = 0; i < 400; i++) s.add(i);
  for (const m of s) { seen.push(m); if (m === 0) for (let i = 1; i <= 100; i++) s.delete(i); if (m === 120) { for (let i = 121; i <= 190; i++) s.delete(i); s.add(1000); } if (m === 200) { for (let i = 201; i < 399; i++) s.delete(i); s.add(1001); } }
  return seen;
}
function clearedInFrontOfALongRun(): number[] {
  const s = new Set<number>(), seen: number[] = []; for (let i = 0; i < 300; i++) s.add(i); for (let i = 1; i <= 90; i++) s.delete(i);
  for (const m of s) { seen.push(m); if (m === 0) { s.clear(); for (let i = 500; i < 510; i++) s.add(i); } }
  return seen;
}
function main(): void {
  for (const from of [0, 1, 2, 9, 290]) { let line = "from " + from + ":"; for (let length = 1; length <= 110; length++) line += " " + ways(400, [[from, length]]); console.log(told([line]), line.includes("WRONG") ? line : "as it must be"); }
  for (const runs of [[[1, 70], [80, 64], [150, 65], [220, 81], [310, 85], [400, 16], [420, 17], [440, 21]], [[0, 100], [101, 100], [202, 100]], [[1500, 100]], [[1, 63], [65, 64], [130, 65], [196, 66]], [[0, 1], [2, 79], [82, 80], [163, 84], [248, 85], [334, 86]]] as Runs[]) console.log("several", ways(1600, runs));
  console.log("taken behind the head", told(takenBehindTheHead(500)));
  console.log("taken from the front", told(takenFromTheFront(500)));
  console.log("deleted ahead of the walk", deletedAheadOfTheWalk().join());
  console.log("cleared in front of a long run", clearedInFrontOfALongRun().join());
}
main();
