// One of two classes is constructed in each of two arms behind the place where they met; the class object is compared and read behind the construction.
// STATISTIC: ConstructsDispatchedByCallee >= 1
class Ash { k: number; constructor(x = 1) { this.k = x; } } class Birch { k: number; constructor(x = 2) { this.k = x * 10; } }
let same = 0, names = "";
for (let i = 0; i < 1000; i++) { const Tree = i & 1 ? Ash : Birch; const tree = i & 2 ? new Tree() : new Tree(3); if (tree.constructor === Tree) same++; if (Tree === Ash) same += tree.k * 1000; if (i < 4) names += Tree.name; }
console.log(same, names);
