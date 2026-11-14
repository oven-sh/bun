// The control of the count: a Set that is made in sight is walked through its table: there is no iterator, so nothing is stepped in the library, and the library that this program reaches counts nothing of its own.
// STATISTIC: IteratorsSteppedWithoutCall = 0
function total(): number { let sum = 0; for (const thing of new Set([1, 2, 3])) sum += thing; return sum; }
let sum = 0;
for (const thing of new Set([4, 5])) sum += thing;
console.log(total(), sum);
