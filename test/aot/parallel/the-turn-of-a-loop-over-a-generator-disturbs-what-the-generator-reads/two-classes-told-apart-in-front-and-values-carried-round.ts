// The loop of a generator is walked with the turn of its consumer inside it: two classes told apart in front and values carried round.
// STATISTIC: LoopsBuiltTwice >= 1
class Evens { at(i: number): number { return i * 2; } }
class Odds { at(i: number): number { return i * 2 + 1; } }
class Walk {
  constructor(public src: Evens | Odds, public n: number) {}
  *[Symbol.iterator](): Generator<number> { const src = this.src; for (let i = 0; i < this.n; i++) yield src.at(i); }
}
function total(w: Walk): number { let sum = 0, n = 0; for (const v of w) { sum += v; n++; } return sum * 10 + n; }
console.log(total(new Walk(new Evens(), 4)), total(new Walk(new Odds(), 4)));
