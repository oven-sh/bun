// The choice between two classes is an argument of a function that constructs its parameter.
// STATISTIC: JoinsDuplicatedPerCallee >= 1
class Ash { k = 1; } class Birch { k = 2; }
function make(Tree: typeof Ash | typeof Birch) { return new Tree(); }
let sum = 0;
for (let i = 0; i < 1000; i++) { const tree = make(i % 3 ? Ash : Birch); sum += tree.k; }
console.log(sum);
