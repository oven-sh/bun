// Each of the two constructors throws in some turns, under a handler.
// STATISTIC: ConstructsDispatchedByCallee >= 1
class Ash { k = 1; constructor(i: number) { if (i % 5 === 0) throw new RangeError("five"); } } class Birch { k = 2; constructor(i: number) { if (i % 7 === 0) throw new TypeError("seven"); } }
let sum = 0, ranges = 0, types = 0;
for (let i = 0; i < 1000; i++) { const Tree = i & 1 ? Ash : Birch; try { const tree = new Tree(i); sum += tree.k; } catch (e) { if (e instanceof RangeError) ranges++; else if (e instanceof TypeError) types++; } }
console.log(sum, ranges, types);
