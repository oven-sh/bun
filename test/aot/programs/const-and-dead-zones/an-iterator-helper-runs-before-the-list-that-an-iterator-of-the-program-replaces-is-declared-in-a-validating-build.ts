// In a validating build: Iterator.prototype.some walks an array's iterator before a list is declared. An iterator of the program, made below the declaration, has the same members and replaces it in next().
console.log([1].values().some(Boolean));
let list: number[] = [1, 2, 3]; let total = 0;
function make(): any { let i = 0; return { [Symbol.iterator](): any { return this; }, next(): any { total += list[0] + list.length; list = [total, total]; const j = i++; return { done: j >= 2, value: j }; }, return(): any { return {}; } }; }
for (const value of make()) { }
console.log(total, list);
