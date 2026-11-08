// Either of two kinds, and a loop that is left early: a list is walked by index, a Set is stepped in the library.
// STATISTIC: IteratorsSteppedWithoutCall = 1
function total(things: Set<number> | number[]): number { let sum = 0; for (const thing of things) { if (thing > 2) break; sum += thing; } return sum; }
console.log(total(process.argv.length > 5 ? [1, 2, 3] : new Set([1, 2, 3])), total(process.argv.length > 5 ? new Set([1, 2, 3]) : [1, 2, 3]));
