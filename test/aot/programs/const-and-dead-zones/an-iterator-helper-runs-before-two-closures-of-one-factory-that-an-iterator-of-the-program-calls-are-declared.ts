// Iterator.prototype.some walks an array's iterator before two closures of one factory are declared. An iterator of the program, made below the declaration, has the same members and calls them in next().
console.log([1].values().some(Boolean));
function adder(n: number): (x: number) => number { return x => x + n; }
const add = adder(process.argv.length); const more = adder(process.argv.length + 5); let total = 0;
function make(): any { let i = 0; return { [Symbol.iterator](): any { return this; }, next(): any { total = add(total) + more(total); const j = i++; return { done: j >= 2, value: j }; }, return(): any { return {}; } }; }
for (const value of make()) { }
console.log(total > 0);
