// find, findLast, at, reduce, reduceRight and flatMap of a list. One function of the library runs for all calls of each. What the calls of this program hand over is all that those functions get here, so the executable holds the program, those functions and what they call.
// Array.from steps the iterator of whatever it gets by a call of its `next`, and closes it by a call of its `return` (WebKit 37aa2b5bd94d). So the two helpers that do that and the `next`, `return` and `throw` of the library's iterators are in the executable too. That is 18 of the 42 functions.
// STATISTIC: ImageFunctionsEmitted <= 48
const list = Array.from({ length: 16 });
console.log(list.find(value => value === undefined), list.findLast(value => value === undefined), list.at(-1));
console.log(list.reduce((count, value) => count + (value === undefined ? 1 : 0), 0), list.reduceRight(count => count + 1, 0));
console.log(list.flatMap(value => [value, value])[31], [[1], [2]].flatMap(value => value)[1]);
