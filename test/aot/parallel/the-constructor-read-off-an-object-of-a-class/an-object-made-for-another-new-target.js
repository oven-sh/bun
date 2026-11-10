// An object made by one heir for the new.target of the other.
// STATISTIC: ConstructorsReadOffObjectsOfClasses >= 1
class Tree { k = 0; again() { return new this.constructor(); } }
class Ash extends Tree { k = 1; }
class Birch extends Tree { k = 20; }
const ash = new Ash(), birch = new Birch(), tree = new Tree();
const mixed = Reflect.construct(Ash, [], Birch);
let sum = 0;
for (let i = 0; i < 300; i++) {  const from = i % 3 ? mixed : ash; const made = from.again(); sum += made.k + (made instanceof Ash ? 300 : 0) + (made instanceof Birch ? 5000 : 0); }
console.log(sum);
