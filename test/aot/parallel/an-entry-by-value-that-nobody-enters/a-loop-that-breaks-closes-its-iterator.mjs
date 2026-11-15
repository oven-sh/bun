// A loop that breaks closes its iterator: `return` is entered out of the engine's own code.
let closed = 0;
class Steps { i = 0; [Symbol.iterator]() { return this; } next() { return { done: false, value: this.i++ }; } return() { closed++; return {}; } }
let sum = 0;
for (let turn = 0; turn < 300; turn++) { for (const step of new Steps()) { sum += step; if (step === 2) break; } }
console.log(sum, closed);
