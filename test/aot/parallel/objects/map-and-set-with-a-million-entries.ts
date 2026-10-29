// A Map or a Set with more than 2 ** 20 entries finds, replaces, deletes and visits its entries like a small one, while it grows to that size and after most of its entries are deleted.
const count = (1 << 20) + 1000;

function run(label: string, keyAt: (index: number) => unknown): void {
  const map = new Map<unknown, number>();
  const set = new Set<unknown>();
  const iterator = set.values();
  for (let index = 0; index < count; index++) {
    const key = keyAt(index);
    map.set(key, index);
    set.add(key);
  }
  console.log(label, "sizes", map.size, set.size);

  let found = 0;
  let sum = 0;
  for (let index = 0; index < count + 1000; index += 7) {
    const key = keyAt(index);
    if (map.has(key) && set.has(key)) found++;
    sum += map.get(key) ?? -1;
  }
  console.log(label, "found", found, sum);

  let visited = 0;
  let inOrder = true;
  for (const [key, value] of map) {
    if (value !== visited || (visited % 100003 === 0 && key !== keyAt(visited))) inOrder = false;
    visited++;
  }
  console.log(label, "visited", visited, inOrder);
  let steps = 0;
  while (!iterator.next().done) steps++;
  console.log(label, "an iterator created while the set is empty", steps);
  console.log(label, "copies", Array.from(set).length, [...map.keys()].length, new Set(set).size, new Map(map).size, set.union(new Set([keyAt(count)])).size, set.isSubsetOf(map));

  for (let index = 0; index < count; index += 2) map.set(keyAt(index), -index);
  let deleted = 0;
  for (let index = 1; index < count; index += 2) if (map.delete(keyAt(index)) && set.delete(keyAt(index))) deleted++;
  console.log(label, "deleted", deleted, map.size, set.size, map.has(keyAt(1)), set.has(keyAt(1)), map.get(keyAt(2)), map.get(keyAt(count - 2)));

  for (let index = 0; index < count; index++) if (index % 1000 !== 0) { map.delete(keyAt(index)); set.delete(keyAt(index)); }
  console.log(label, "left", map.size, set.size, [...map.values()].slice(0, 3).join(), [...set].length, [...map.keys()].at(-1) === keyAt(count - (count % 1000)));
  map.set(keyAt(1), 1);
  set.add(keyAt(1));
  console.log(label, "added again", [...map.values()].at(-1), [...set].at(-1) === keyAt(1));
  map.clear();
  set.clear();
  console.log(label, "cleared", map.size, set.size, map.has(keyAt(0)), set.has(keyAt(0)), [...map].length, [...set].length);
}

run("integers", index => index);
const names = Array.from({ length: count + 1000 }, (_, index) => "k" + index);
run("strings", index => names[index]);
