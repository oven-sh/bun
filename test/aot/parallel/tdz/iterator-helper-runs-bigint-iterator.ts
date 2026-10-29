// In a validating build: Iterator.prototype.some walks an array's iterator before a bigint is declared. An iterator of the program, made below the declaration, has the same members and replaces it in next().
// Flags: --aot-validate
console.log([1].values().some(Boolean));
let big = 1n;
function make(): any { let i = 0; return { [Symbol.iterator](): any { return this; }, next(): any { big = big * 3n; const j = i++; return { done: j >= 2, value: j }; }, return(): any { return {}; } }; }
for (const value of make()) { }
console.log(big);
