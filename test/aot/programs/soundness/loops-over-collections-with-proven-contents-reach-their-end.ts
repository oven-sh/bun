class Key {
  constructor(public x: number) {}
}
class Value {
  constructor(public y: string) {}
}

const byKey = new Map<Key, Value>([
  [new Key(1), new Value("one")],
  [new Key(2), new Value("two")],
]);
for (const [key, value] of byKey) console.log("entries", key.x, value.y);
for (const key of byKey.keys()) console.log("keys", key.x);
for (const value of byKey.values()) console.log("values", value.y);
byKey.forEach((value, key) => console.log("forEach", key.x, value.y));

const counts = new Map<string, number>();
for (const word of ["a", "b", "a"]) counts.set(word, (counts.get(word) ?? 0) + 1);
let total = 0;
for (const [word, count] of counts) total += count * word.length;
console.log("counts", total);

const keys = new Set<Key>([new Key(3), new Key(4)]);
for (const key of keys) console.log("set", key.x);
keys.forEach(key => console.log("set forEach", key.x));

const empty = new Map<string, Value>();
for (const [name, value] of empty) console.log("never", name.length, value.y);
console.log("end");
