// The run time keeps what it enters the library by from one pattern, and one spread, to the next. Whole collections come in between, and what they free is filled again with functions and small objects.
// A cell that is freed and not used again still works where nothing overwrites it: so whatever is freed is overwritten.
// Env of the executable: BUN_JSC_scribbleFreeCells=1
// Env of the executable: BUN_JSC_useZombieMode=1
class Counts { constructor(public upTo: number) {} [Symbol.iterator]() { let at = 0; const upTo = this.upTo; return { next: () => at < upTo ? { done: false, value: ++at } : { done: true, value: undefined } }; } }
function two(items: Iterable<number>) { const [a, b] = items; return a + b; }
function all(items: Iterable<number>) { return [...items].length; }
function* counts(upTo: number) { for (let at = 1; at <= upTo; at++) yield at; }
let total = 0;
let kept: unknown[] = [];
for (let round = 0; round < 40; round++) {
  total += two(new Counts(3)) + all(new Counts(5)) + two(counts(4)) + all(counts(6));
  kept = [];
  Bun.gc(true);
  for (let index = 0; index < 30000; index++) kept.push(index % 3 === 0 ? () => index : index % 3 === 1 ? function () { return round; } : { index });
  Bun.gc(true);
  total += kept.length;
}
console.log(total);
