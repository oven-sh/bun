// The construction of one of two stands under a finally and a catch.
// STATISTIC: ConstructionsToldApartByCallee >= 1
class Ash { k = 1; constructor(i: number) { if (i % 11 === 0) throw new Error("no"); } } class Birch { k = 2; }
let sum = 0, ends = 0, caught = 0;
for (let i = 0; i < 1000; i++) { const Tree: any = i & 1 ? Ash : Birch; try { try { sum += new Tree(i).k; } finally { ends++; } } catch { caught++; } }
console.log(sum, ends, caught);
