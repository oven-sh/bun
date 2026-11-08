// Where the compiler knows that what is spread is an object of the program's own, the function of the library is called where the spread stands: the operation of the run time is not entered.
// COUNTER: operationAOTAppendIterable = 0
class Range { constructor(public limit: number) {} [Symbol.iterator]() { let i = 0; const limit = this.limit; return { next: () => (i < limit ? { done: false, value: i++ } : { done: true, value: undefined }) }; } }
class Walk { constructor(public limit: number) {} *[Symbol.iterator]() { for (let i = 0; i < this.limit; i++) yield i * 2; } }
const count = (...values: number[]) => values.length;
let total = 0;
for (let turn = 0; turn < 5000; turn++) total += [...new Range(turn % 5)].length + count(...new Walk(turn % 3)) + ["head", ...new Range(2), ...new Walk(1)].length; // @ts-expect-error
console.log(total, [...new Range(4)].join(), [...new Walk(4)].join(), Math.max(...new Range(6)));
