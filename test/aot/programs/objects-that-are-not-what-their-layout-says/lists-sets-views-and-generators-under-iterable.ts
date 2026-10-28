// Iterable<number> takes an instance of a class, a list, a Set, a typed array and a generator
function tell(v: Iterable<number>): string {
  let s = 0;
  for (const n of v) s += n;
  return s + "|" + Array.isArray(v) + "|" + (v instanceof Set) + "|" + (v instanceof Map) + "|" + typeof v;
}
class Range {
  constructor(public n: number) {}
  *[Symbol.iterator]() {
    for (let i = 0; i < this.n; i++) yield i;
  }
}
const list: Iterable<number>[] = [
  new Range(4),
  [1, 2],
  new Set([5]),
  new Uint8Array([9]),
  (function* () {
    yield 3;
  })(),
];
for (let round = 0; round < 3; round++) for (const v of list) console.log(tell(v));
