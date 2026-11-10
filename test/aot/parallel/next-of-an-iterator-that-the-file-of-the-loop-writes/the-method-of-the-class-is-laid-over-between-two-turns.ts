// The loop expects under `next` what the class writes. From one turn on another function lies over the method of the class, and its iterators hold another `next`.
class Shelf { [Symbol.iterator]() { let at = 0; return { next: () => (at < 4 ? { done: false, value: at++ } : { done: true, value: undefined }) }; } }
const shelf = new Shelf();
function total(turns: number, when: number): number {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    if (turn === when) (Shelf.prototype as any)[Symbol.iterator] = function () { let left = 2; return { next: () => ({ done: left-- <= 0, value: 100 }) }; };
    for (const item of shelf) sum += item as number;
  }
  return sum;
}
function firstThree(turns: number): number { let sum = 0; for (let turn = 0; turn < turns; turn++) { const [a, b, c] = shelf; sum += (a as number) + (b as number) + ((c as number) ?? -1000); } return sum; }
(globalThis as any).keep = [total, firstThree, new Shelf()];
const when = Number(process.argv[2] ?? 3);
console.log(firstThree(5), total(6, when), firstThree(5), total(6, -1));
