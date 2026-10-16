// `for..of` reads `next` once, so replacing it on the prototype during the loop changes nothing.
declare const console: { log(...a: unknown[]): void };
class It { n = 0; next() { return { done: this.n > 2, value: this.n++ }; } [Symbol.iterator]() { return this; } }
for (const x of new It()) { console.log(x); It.prototype.next = () => ({ done: true, value: 9 }); }
