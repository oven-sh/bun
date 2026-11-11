// A method above constructs this.constructor, off one object.
// STATISTIC: ConstructorReadsResolvedToClasses >= 1
class Tree { k = 0; again() { return new this.constructor(); } }
class Ash extends Tree { k = 1; }
class Birch extends Tree { k = 20; }
const ash = new Ash(), birch = new Birch(), tree = new Tree();
let sum = 0;
for (let i = 0; i < 300; i++) {  const from = ash; const made = from.again(); sum += made.k + (made instanceof Ash ? 300 : 0) + (made instanceof Birch ? 5000 : 0); }
console.log(sum);
