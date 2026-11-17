// The objects of both classes are kept in a list and asked for their classes afterwards.
// STATISTIC: JoinsDuplicatedPerCallee >= 1
class Ash { k = 1; } class Birch { k = 2; }
const kept: (Ash | Birch)[] = [];
for (let i = 0; i < 1000; i++) { const Tree = i % 3 ? Ash : Birch; const tree = new Tree(); kept.push(tree); }
let ashes = 0, birches = 0, sum = 0;
for (const tree of kept) { if (tree instanceof Ash) ashes++; if (tree instanceof Birch) birches++; sum += tree.k; }
console.log(ashes, birches, sum, kept[0].constructor === Birch, kept[1].constructor === Ash);
