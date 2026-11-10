// A name made at run time spells constructor: a static method of one heir, a definition on the prototype of the other.
// STATISTIC: ConstructorReadsResolvedToClasses >= 1
const name = "constr" + "uctor";
class Tree { k = 0; again() { return new this.constructor(); } }
class Ash extends Tree { k = 1; static [name]() { return 9; } }
class Birch extends Tree { k = 20; }
Object.defineProperty(Birch.prototype, name, { value: Ash, writable: true, configurable: true });
const ash = new Ash(), birch = new Birch();
let sum = 0;
for (let i = 0; i < 300; i++) {  const from = i % 3 ? ash : birch; const made = from.again(); sum += made.k + (made instanceof Ash ? 300 : 0) + (made instanceof Birch ? 5000 : 0); }
console.log(sum);
