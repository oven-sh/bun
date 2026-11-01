// every(), find() and some() with built-in functions as callbacks walk an array's iterator before `text` is declared. An iterator of the program, made below the declaration, appends to `text` in next().
console.log([1].values().every(Boolean), [1].values().find(Boolean));
console.log([1].values().some(Number), [1].values().some(String), [1].values().some(Array.isArray), [1].values().some(isNaN));
let text = "";
function log(part: string): void { text += part; }
function make(): any { let i = 0; return { [Symbol.iterator](): any { return this; }, next(): any { log("n"); const j = i++; return { done: j >= 2, value: j }; }, return(): any { return {}; } }; }
for (const value of make()) log("b");
console.log(text);
