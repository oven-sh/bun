// Iterator.prototype.some walks an array's iterator before two closures that count are declared. An iterator of the program, made below the declaration, has the same members and calls them in next().
console.log([1].values().some(Boolean));
function counter(): () => number { let count = 0; return () => ++count; }
const first = counter(); const second = counter(); let total = 0;
function make(): any { let i = 0; return { [Symbol.iterator](): any { return this; }, next(): any { total += first() + second() + first(); const j = i++; return { done: j >= 2, value: j }; }, return(): any { return {}; } }; }
for (const value of make()) { }
console.log(total);
