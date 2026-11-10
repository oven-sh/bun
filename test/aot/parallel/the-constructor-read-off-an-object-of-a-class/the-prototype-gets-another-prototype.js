// The prototype of one heir loses its constructor and gets the prototype of a class outside the row.
// STATISTIC: ConstructorsReadOffObjectsOfClasses >= 1
class Tree { k = 0; again() { return new this.constructor(); } }
class Ash extends Tree { k = 1; }
class Birch extends Tree { k = 20; }
const ash = new Ash(), birch = new Birch(), tree = new Tree();
class Other { k = 7000000; }
let sum = 0;
for (let i = 0; i < 300; i++) { if (i === 150) { delete Ash.prototype.constructor; Object.setPrototypeOf(Ash.prototype, Other.prototype); ash.again = Tree.prototype.again; } const from = i % 3 ? ash : birch; const made = from.again(); sum += made.k + (made instanceof Ash ? 300 : 0) + (made instanceof Birch ? 5000 : 0); }
console.log(sum);
