// In the middle of the loop constructor is deleted from the prototype of one heir, so that the one above is found.
// STATISTIC: ConstructorReadsResolvedToClasses >= 1
class Tree { k = 0; again() { return new this.constructor(); } }
class Ash extends Tree { k = 1; }
class Birch extends Tree { k = 20; }
const ash = new Ash(), birch = new Birch(), tree = new Tree();
let sum = 0;
for (let i = 0; i < 300; i++) { if (i === 150) delete Ash.prototype.constructor; const from = i % 3 ? ash : birch; const made = from.again(); sum += made.k + (made instanceof Ash ? 300 : 0) + (made instanceof Birch ? 5000 : 0); }
console.log(sum);
