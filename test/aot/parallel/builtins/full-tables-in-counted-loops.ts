// Counted loops that store into a Map or add to a Set whose table is exactly full: they replace values, add new keys late, delete in between, or do nothing. Sizes and order stay those of plain Bun.
function fill(count: number): Map<number, number> {
  const map = new Map<number, number>();
  for (let i = 0; i < count; i++) map.set(i * 3, i);
  return map;
}
function replaceAll(map: Map<number, number>, count: number, by: number): number {
  for (let i = 0; i < count; i++) map.set(i * 3, i + by);
  return map.size;
}
function replaceThenAdd(map: Map<number, number>, count: number, from: number): number {
  for (let i = 0; i < count; i++) map.set(i < from ? i * 3 : i * 3 + 1, i);
  return map.size;
}
function addThenReplace(map: Map<number, number>, count: number, until: number): number {
  for (let i = 0; i < count; i++) map.set(i < until ? -1 - i : (i - until) * 3, i);
  return map.size;
}
function addAgain(set: Set<string>, words: string[], count: number): number {
  for (let i = 0; i < count; i++) set.add(words[i % words.length]!);
  return set.size;
}
function deleteAndReplace(map: Map<number, number>, count: number): number {
  for (let i = 0; i < count; i++) {
    if (i % 7 === 3) map.delete(i * 3);
    map.set(((i + 1) % count) * 3, i);
  }
  return map.size;
}
const sum = (map: Map<number, number>): string => {
  let keys = 0,
    values = 0,
    first = "";
  for (const [key, value] of map) {
    if (first.length < 24) first += key + ":" + value + " ";
    keys += key;
    values += value;
  }
  return `${map.size} ${keys} ${values} ${first}`;
};
for (const count of [1, 2, 4, 7, 8, 9, 16, 31, 32, 33, 64, 100, 128, 256, 1000]) {
  const a = fill(count);
  console.log(count, "replace", replaceAll(a, count, 1), replaceAll(a, count, 2), sum(a));
  const b = fill(count);
  console.log(
    count,
    "replace then add",
    replaceThenAdd(b, count, count >> 1),
    replaceThenAdd(b, count * 2, count),
    sum(b),
  );
  const c = fill(count);
  console.log(count, "add then replace", addThenReplace(c, count, count >> 2), addThenReplace(c, count, 1), sum(c));
  const d = fill(count);
  console.log(count, "delete and replace", deleteAndReplace(d, count), deleteAndReplace(d, count), sum(d));
  const words = Array.from({ length: count }, (_, i) => "w" + i);
  const set = new Set(words);
  console.log(
    count,
    "add again",
    addAgain(set, words, count * 3),
    addAgain(set, [...words, "more", "and more"], count * 3 + 5),
    [...set].slice(-3).join(),
  );
  const empty = new Map<number, number>();
  console.log(count, "from empty", replaceAll(empty, count, 0), replaceAll(empty, count, 5), sum(empty));
}
