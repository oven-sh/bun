// A loop of which nothing is known asks once, where it opens the iterator, which way it is stepped, and steps a Set's, a Map's and a list's iterator in the library without a call of `next`.
// The build counts the arm: in this small program, built alone, with nothing else in it that could bring the two helpers in.
// STATISTIC: IteratorsSteppedWithoutCall = 1
function total(things: any): number { let sum = 0; for (const thing of things) sum += thing; return sum; }
console.log(total(JSON.parse("[1,2,3]")), total(new Set(JSON.parse("[1,2,3]"))), total(new Map([[1, 2]]).keys()));
