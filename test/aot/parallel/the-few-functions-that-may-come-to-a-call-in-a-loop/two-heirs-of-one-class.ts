// Two heirs of one class, one with a constructor of its own, one with a method that calls the one above.
// STATISTIC: JoinsWalkedOnceForEachCallee >= 1
class Tree { height: number; constructor(h: number) { this.height = h; } grow() { return this.height + 1; } }
class Ash extends Tree { k = 1; constructor(h: number) { super(h * 2); } } class Birch extends Tree { k = 2; grow() { return super.grow() * 10; } }
let sum = 0;
for (let i = 0; i < 1000; i++) { const Kind = i & 1 ? Ash : Birch; const tree = new Kind(i & 3); sum += tree.k + tree.grow(); }
console.log(sum);
