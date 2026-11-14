// The word of the source is a guess: whatever arrives gets the answer of plain code, and a getter under `length` runs as often as the text reads it.
// STATISTIC: ArrayParameterChecksSpanningBranches >= 1
function gather(parts: readonly number[], bonus: number): unknown {
  if (parts.length === 0) return bonus;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] + parts[1] * bonus;
  return "many";
}
let reads = 0;
const counted = { get length() { return ++reads; }, 0: 7, 1: 8 };
const seen: string[] = [];
const watched = new Proxy([4, 5], { get(target, key, receiver) { seen.push(String(key)); return Reflect.get(target, key, receiver); } });
class Longer extends Array<number> { get length() { return 1; } set length(_: number) {} }
const longer = new Longer(); Object.defineProperty(longer, 0, { value: 9, writable: true, configurable: true, enumerable: true });
function asArguments(..._: number[]) { return arguments; }
const all: unknown[] = [[], [1], [2, 3], [1, 2, 3], counted, counted, watched, longer, "", "a", "ab", new Uint8Array(2), new Float64Array([1.5]), asArguments(6, 7), { length: 2, 0: 1, 1: 1 }, 5, true];
(globalThis as any).gatherOfThisTest = gather;
const byName: (parts: unknown, bonus: number) => unknown = (globalThis as any)["gatherOf" + "ThisTest"];
for (const one of all) console.log(String(byName(one, 10)), reads);
console.log(seen.join());
for (const none of [null, undefined]) { try { byName(none, 1); } catch (error) { console.log((error as Error).constructor.name); } }
