// A symbol that the program makes once names no built-in member.
const key = Symbol("x");
globalThis[key] = 1;
console.log(globalThis[key]);
