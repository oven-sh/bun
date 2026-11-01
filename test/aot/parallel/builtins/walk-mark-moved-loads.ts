// Flags: --aot-check=MovedLoads
// A step of a walk marks the table of a Map or a Set in the byte that also says how wide its keys are. Reads of that byte move across the mark: they ask for the bits beside it.
function pairs(list: [string, number][]): [string, number][] { return Array.from(new Map(list)); }
function unique(list: number[]): number[] { return Array.from(new Set(list)); }
function walked(list: number[]): number {
  const set = new Set(list);
  let sum = 0;
  for (const each of set) { sum += each; if (set.has(each + 1)) sum += 100; }
  set.clear();
  for (const each of list) set.add(each * 2);
  for (const each of set) sum += each;
  return sum + set.size;
}
console.log(JSON.stringify(pairs([["a", 1], ["b", 2], ["a", 3]])), JSON.stringify(unique([3, 1, 3, 2, 1])), walked([1, 2, 5]));
let sum = 0;
for (let i = 0; i < 20000; i++) sum += unique([i & 3, 1, 1]).length + walked([i & 7, 2]);
console.log(sum);
