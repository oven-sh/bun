// A weak map is read, an operation throws, and the map is read again behind the handler. The error is allocated on the way to the handler, so a collection may have moved the table of the map meanwhile: nothing of it may be kept across the throw.
class Box {
  #secret = 1;
  static read(value: any): number {
    return value.#secret;
  }
}

function probe(weak: WeakMap<object, number>, keys: object[], wrong: object): number {
  let sum = 0;
  for (let index = 0; index + 1 < keys.length; index++) {
    sum += weak.get(keys[index])!;
    try {
      sum += Box.read(wrong);
    } catch {
      sum++;
    }
    sum += weak.get(keys[index + 1])!;
  }
  return sum;
}

let total = 0;
for (let round = 0; round < 40; round++) {
  const weak = new WeakMap<object, number>();
  const keys: object[] = [];
  for (let index = 0; index < 400; index++) {
    const key = { index };
    weak.set(key, index);
    if (index % 20 === 0) keys.push(key);
  }
  total += probe(weak, keys, {});
}
console.log(total);
