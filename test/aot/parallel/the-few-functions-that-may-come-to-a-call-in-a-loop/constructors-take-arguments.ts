// One constructor has a default, the other takes a rest list, and they are handed one argument or two.
// STATISTIC: ConstructionsToldApartByCallee >= 1
class Ash { k: number; constructor(x: number, y = 5) { this.k = x + y; } } class Birch { k: number; constructor(...all: number[]) { this.k = all.length * 100; } }
let sum = 0;
for (let i = 0; i < 1000; i++) { const Tree = i & 1 ? Ash : Birch; const tree = i & 2 ? new Tree(i & 7) : new Tree(i & 7, 1); sum += tree.k; }
console.log(sum);
