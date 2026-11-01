// More keys than the 24 bits of a key's hash have values, which takes an index whose home slots are spread out: asked for keys that it holds and keys that it lacks,
// in a loop and one call at a time, and for what was added behind the first search.
export {};

const count = 12_700_000;
const set = new Set<number>();
for (let key = 0; key < count; key++) set.add(key * 2);

function held(from: number, to: number, step: number): number {
  let found = 0;
  for (let key = from; key < to; key += step) if (set.has(key)) found++;
  return found;
}
const oneAtATime = [(key: number) => set.has(key), (key: number) => !set.has(key)];
function heldOneAtATime(from: number, to: number, step: number): number {
  const has = oneAtATime[from < 0 ? 1 : 0]!;
  let found = 0;
  for (let key = from; key < to; key += step) if (has(key)) found++;
  return found;
}

console.log("size", set.size);
console.log("even keys", held(0, 2 * count, 2_002));
console.log("odd keys", held(1, 2 * count, 2_002));
console.log("behind the last", held(2 * count, 2 * count + 40_000, 2));
console.log("even keys, one at a time", heldOneAtATime(0, 2 * count, 2_002));
console.log("odd keys, one at a time", heldOneAtATime(1, 2 * count, 2_002));

for (let key = 1; key < 40_000; key += 2) set.add(key);
for (let key = 0; key < 40_000; key += 4) set.delete(key);
console.log("size after changes", set.size);
console.log("near the start", held(0, 80_000, 1));
console.log("near the start, one at a time", heldOneAtATime(0, 80_000, 1));

const texts = new Set<string>();
for (let i = 0; i < 40; i++) texts.add("text" + i);
function textsHeld(from: number, to: number): number {
  let found = 0;
  for (let i = from; i < to; i++) if (texts.has("text" + i)) found++;
  return found;
}
console.log("texts beside it", textsHeld(0, 80));
