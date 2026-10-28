// The collector: weak map shrinks in a throw. It prints what plain Bun prints.
class Box {
  #secret = 1;
  static read(value: any): number {
    return value.#secret;
  }
}

function probe(weak: WeakMap<object, number>, keys: object[], all: object[], wrong: object): number {
  let sum = 0;
  all.length = 0;
  for (let round = 0; round < 400; round++) {
    for (let index = 0; index + 1 < keys.length; index++) {
      sum += weak.get(keys[index])!;
      try {
        sum += Box.read(wrong);
      } catch {
        sum++;
      }
      sum += weak.get(keys[index + 1])!;
    }
  }
  return sum;
}

function build(weak: WeakMap<object, number>, keys: object[], all: object[], count: number): void {
  for (let index = 0; index < count; index++) {
    const key = { index };
    weak.set(key, index);
    all.push(key);
    if (index % (count / 8) === 0) keys.push(key);
  }
}

let total = 0;
for (const count of [64, 512, 4096, 32768, 262144]) {
  for (let round = 0; round < 3; round++) {
    const weak = new WeakMap<object, number>();
    const keys: object[] = [];
    const all: object[] = [];
    build(weak, keys, all, count);
    total += probe(weak, keys, all, {});
  }
}
console.log(total);
