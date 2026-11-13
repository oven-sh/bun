// constructor is read and compared, not constructed.
class Tree { k = 0; again() { return new this.constructor(); } }
class Ash extends Tree { k = 1; }
class Birch extends Tree { k = 20; }
const ash = new Ash(), birch = new Birch(), tree = new Tree();
let same = 0;
for (let i = 0; i < 300; i++) { if (i === 150) Ash.prototype.constructor = Birch; const from = i % 3 ? ash : birch; const C = from.constructor; if (C === Ash) same += 1; if (C === Birch) same += 1000; }
console.log(same);
