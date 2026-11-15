// The twin of the-step-in-the-library-is-counted.ts: the same loop beside methods of lists, a generator and a spread: the arm is built as it is there: how the loop is compiled does not hang on the rest of the program.
// STATISTIC: IteratorsSteppedWithoutCall = 1
function total(things: any): number { let sum = 0; for (const thing of things) sum += thing; return sum; }
function* made(): Generator<number> { yield 4; }
console.log(total(JSON.parse("[1,2,3]")), total(new Set(JSON.parse("[1,2,3]"))), total(new Map([[1, 2]]).keys()), [1, 2].map(x => x + 1).filter(x => x > 2).length, [...made()].length);
