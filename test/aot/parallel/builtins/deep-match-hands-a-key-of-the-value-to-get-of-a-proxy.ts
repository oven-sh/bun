// Bun.deepMatch(subset, value) asks a Proxy around a Map in the subset for the value under each key of the value. get() writes the key that it is handed, and the caller reads it in front of the call and behind it.
class Key {
  id: number = 1;
}
let calls = 0;
// A Proxy without traps calls each method on itself, so none of them may ask the Map below.
class Served extends Map<Key, number> {
  get size(): number {
    return 1;
  }
  has(key: Key): boolean {
    return true;
  }
  get(key: Key): number {
    calls++;
    key.id = 7;
    return 1;
  }
  [Symbol.iterator](): MapIterator<[Key, number]> {
    return ([] as [Key, number][])[Symbol.iterator]() as unknown as MapIterator<[Key, number]>;
  }
}
function run(): (number | boolean)[] {
  const key = new Key();
  const before = key.id;
  const matched = Bun.deepMatch(new Proxy(new Served(), {}), new Map<Key, number>([[key, 1]]));
  return [before, matched, key.id, calls];
}
for (let turn = 0; turn < 3; turn++) console.log(JSON.stringify(run()));
