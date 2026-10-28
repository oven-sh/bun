// Iterator.prototype.some walks an array's iterator before two closures that append to a text are declared. An iterator of the program, made below the declaration, has the same members and calls them in next().
console.log([1].values().some(Boolean));
function writer(): (part: string) => string { let out = ""; return part => (out += part); }
let write = writer(); const other = writer(); let text = "";
function make(): any { let i = 0; return { [Symbol.iterator](): any { return this; }, next(): any { text = write("n") + other("m"); const j = i++; return { done: j >= 2, value: j }; }, return(): any { return {}; } }; }
for (const value of make()) { }
console.log(text);
