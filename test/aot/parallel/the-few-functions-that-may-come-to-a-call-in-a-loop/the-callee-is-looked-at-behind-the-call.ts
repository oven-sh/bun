// The class object that was constructed is compared and read behind the construction.
// STATISTIC: JoinsWalkedOnceForEachCallee >= 1
// STATISTIC: ConstructorsReadOffObjectsOfClasses >= 1
class Ash { k = 1; } class Birch { k = 2; }
let same = 0, names = "";
for (let i = 0; i < 1000; i++) { const Tree = i & 1 ? Ash : Birch; const tree = new Tree(); if (tree.constructor === Tree) same++; if (i < 4) names += Tree.name; }
console.log(same, names);
