// More arguments, two spreads, a generator, a set, an object with a generator method, a call in tail position: the list of arguments is made as ever, and whoever goes over it answers the same.
function* two(t: number) { yield t; yield 1; }
class Shelf { books = [3, 9, 4]; *[Symbol.iterator]() { yield* this.books; } }
function inTail(list: number[]): number { return Math.max(...list); }
function appliedInTail(list: number[]): number { return Math.min.apply(null, list); }
const list = JSON.parse("[5,2,8]") as number[];
const out: number[] = [];
for (let round = 0; round < 3; round++) {
  const withMore = Math.max(0, ...list); const twice = Math.min(...list, ...list); const made = Math.max(...two(round)); const kept = Math.min(...new Set(list)); const shelved = Math.max(...new Shelf());
  out.push(withMore, twice, made, kept, shelved, inTail(list), appliedInTail(list));
}
console.log(out.join(" "));
