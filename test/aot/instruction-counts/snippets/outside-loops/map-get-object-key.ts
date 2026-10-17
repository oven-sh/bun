// looks up an object that a Map holds, outside loops
const operations = 4;
class Key {
  id: number;
  constructor(id: number) {
    this.id = id;
  }
}
let one: Key = new Key(1);
let two: Key = new Key(process.argv.length);
let ages: Map<Key, number> = new Map([
  [one, 1],
  [two, 2],
]);
let total = 0;

kernel: {
  total += ages.get(one)!;
  total += ages.get(two)!;
  total += ages.get(one)!;
  total += ages.get(two)!;
}

console.log(total);
