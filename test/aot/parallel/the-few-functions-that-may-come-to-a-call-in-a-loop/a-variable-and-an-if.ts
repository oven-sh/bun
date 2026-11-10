// A variable holds one class and an if stores another: each way constructs its own.
// STATISTIC: JoinsWalkedOnceForEachCallee >= 1
class Ash { k = 1; } class Birch { k = 2; }
let sum = 0;
for (let i = 0; i < 1000; i++) { let Tree: typeof Ash | typeof Birch = Ash; if (i % 3 === 0) Tree = Birch; const tree = new Tree(); sum += tree.k; }
console.log(sum);
