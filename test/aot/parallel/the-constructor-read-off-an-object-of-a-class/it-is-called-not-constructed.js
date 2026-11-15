// constructor is called without new, which throws.
class Tree { k = 0; again() { return new this.constructor(); } }
class Ash extends Tree { k = 1; }
class Birch extends Tree { k = 20; }
const ash = new Ash(), birch = new Birch(), tree = new Tree();
let refused = 0;
for (let i = 0; i < 300; i++) { const from = i % 3 ? ash : birch; try { from.constructor(); } catch (e) { refused += e.constructor === TypeError ? 1 : 1000; } }
console.log(refused);
