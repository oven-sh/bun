// The receiver is known to be a Map or a Set only behind a test that stands in front of the loop.
function sumOrNothing(maybe: Map<string, number> | null | undefined, turns: number): number {
  if (maybe == null) return -1;
  let total = 0;
  for (let i = 0; i < turns; i++) total += maybe.get(i & 1 ? "a" : "b") ?? 1;
  return total;
}
function countIfSet(value: Set<string> | number | string, turns: number): number {
  if (typeof value !== "object") return -2;
  let total = 0;
  for (let i = 0; i < turns; i++) if (value.has(i & 1 ? "a" : "b")) total++;
  return total;
}
function sumOfEither(value: Map<string, number> | { other: number }, turns: number): number {
  if (!(value instanceof Map)) return value.other;
  let total = 0;
  for (let i = 0; i < turns; i++) total += value.get(i & 1 ? "a" : "b") ?? 1;
  return total;
}
function inTwoLoops(tables: (Map<string, number> | null)[], turns: number): number {
  let total = 0;
  for (const table of tables) {
    if (table === null) {
      total -= 1;
      continue;
    }
    for (let i = 0; i < turns; i++) total += table.get(i & 1 ? "a" : "b") ?? 1;
  }
  return total;
}
const map = new Map([["a", 5]]);
const set = new Set(["a"]);
for (let round = 0; round < 3; round++) {
  console.log(sumOrNothing(map, 3000), sumOrNothing(null, 3000), sumOrNothing(undefined, 3000));
  console.log(countIfSet(set, 3000), countIfSet(7, 3000), countIfSet("text", 3000));
  console.log(sumOfEither(map, 3000), sumOfEither({ other: 9 }, 3000));
  console.log(inTwoLoops([null, map, null, new Map(), map], 3000));
}
