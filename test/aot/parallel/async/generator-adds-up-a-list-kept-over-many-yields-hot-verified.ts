// A generator keeps a list over many yields and adds it up behind the last of them. Everything is compiled as hot code, so the loop that adds is copied into the generator.
// Flags: --aot-heat=everything-is-hot --aot-check=verify-each-stage
const marks: string[] = [];
function mark(...parts: unknown[]) {
  marks.push(parts.map(String).join());
}
function total(list: number[]) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}
function* twice(k: number) {
  yield k;
  yield k + 1;
}
function byHand(k: number, kind: number): Generator<number | undefined> {
  let i = 0;
  const iterator: any = {
    [Symbol.iterator]() {
      return this;
    },
    next() {
      return i < 2 ? { value: i++, done: false } : { value: k, done: true };
    },
  };
  if (kind === 4) Object.defineProperty(iterator, "return", {});
  if (kind === 5) iterator.throw = () => 0;
  return iterator;
}
const home = {
  *steps(start: number): Generator<number | undefined> {
    let n: number = start;
    const list: number[] = [start];
    yield;
    mark(list[0]);
    try {
      try {
      } finally {
        yield* byHand(80, 2);
        mark();
      }
    } finally {
      try {
        n += yield* byHand(70, 0);
        list.push(n);
      } finally {
        yield;
      }
    }
    for (const x of twice(40))
      try {
      } finally {
        yield yield n;
        mark(total(list));
      }
    yield n;
  },
};
for (const value of home.steps(7)) marks.push(String(value));
console.log(marks.join());
