// The loop of a generator is walked with the turn of its consumer inside it: two lists are gone over and the turn swaps them.
class Pair { constructor(public left: number[], public right: number[]) {} *[Symbol.iterator]() { for (const one of this.left) yield one; for (const other of this.right) yield other; } }
function total(pair: Pair): string { let sum = 0; for (const value of pair) { if (value === 2) { const kept = pair.left; pair.left = pair.right; pair.right = kept; pair.right.push(0.5); } sum += value; } return String(sum); }
for (let run = 0; run < 3; run++) console.log(total(new Pair([1, 2, 3], [10, 20])));
