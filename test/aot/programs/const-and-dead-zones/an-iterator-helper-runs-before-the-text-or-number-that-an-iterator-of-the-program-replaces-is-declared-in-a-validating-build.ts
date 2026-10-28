// In a validating build: Iterator.prototype.some walks an array's iterator before a text or number is declared. An iterator of the program, made below the declaration, has the same members and replaces it in next().
console.log([1].values().some(Boolean));
let either: string | number = "a"; let total = 0;
function make(): any { let i = 0; return { [Symbol.iterator](): any { return this; }, next(): any { if (typeof either === "string") { total += either.length; either = total; } else { total += either; either = "bb"; } const j = i++; return { done: j >= 2, value: j }; }, return(): any { return {}; } }; }
for (const value of make()) { }
console.log(total, either);
