// In a validating build: Iterator.prototype.some walks an array's iterator before `text` is declared. An iterator of the program, made below the declaration, has the same members and appends to `text` in next().
console.log([1].values().some(Boolean));
let text = "";
function log(part: string): void { text += part; }
function make(): any { let i = 0; return { [Symbol.iterator](): any { return this; }, next(): any { log("n"); const j = i++; return { done: j >= 2, value: j }; }, return(): any { return {}; } }; }
for (const value of make()) log("b");
console.log(text);
