// `length` of a small array literal, directly and through a function.
const a = [1, 2];
console.log(a.length);
function f(x: number[]) { return x.length; }
console.log(f(a), f([1, 2, 3]));
const m = new Map<string, number>([["a", 1], ["b", 2]]);
console.log(m.size);
