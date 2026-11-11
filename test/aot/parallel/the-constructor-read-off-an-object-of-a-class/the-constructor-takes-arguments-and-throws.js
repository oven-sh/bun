// The constructors take an argument and throw in some turns.
// STATISTIC: ConstructorReadsResolvedToClasses >= 1
class Tree { k; constructor(k) { if (k % 7 === 0) throw new RangeError("seven"); this.k = k; } next() { return new this.constructor(this.k + 1); } }
class Ash extends Tree { constructor(k) { super(k * 2); } }
let sum = 0, thrown = 0;
for (let i = 1; i < 300; i++) { try { const from = i & 1 ? new Tree(i) : new Ash(i); sum += from.next().k; } catch (e) { thrown += e instanceof RangeError ? 1 : 1000; } }
console.log(sum, thrown);
