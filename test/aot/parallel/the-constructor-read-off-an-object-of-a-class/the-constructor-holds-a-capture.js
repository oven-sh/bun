// The class stands in a function that runs once, and its constructor reads a variable of that function.
function once(step) { class Counter { constructor() { this.k = step; step += 1; } again() { return new this.constructor(); } } return new Counter(); }
const first = once(3);
let sum = 0;
for (let i = 0; i < 300; i++) { const made = first.again(); sum += made.k + (made.constructor === first.constructor ? 1000 : 0); }
console.log(sum);
