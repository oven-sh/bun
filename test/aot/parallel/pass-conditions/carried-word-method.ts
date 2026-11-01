// Alone: what a loop keeps in a register goes by which bodies are copied into it, and that by all that the executable holds
class Plain { n = 1; }
class Other { n = 1; k = 3; bump(): void { this.n = (this.n + this.k) | 0; } }
class Pair { constructor(public a: Plain | Other, public b: Plain) {} }
function run(holder: Plain | Other, other: Plain, turns: number): number {
  for (let j = 0; j < turns; j++) {
    holder.n = (holder.n + 1) | 0;
    if (j === 1) other.n = 50;
    if (holder instanceof Other) holder.bump();
  }
  return holder.n;
}
const one = new Plain();
const pairs = [new Pair(new Other(), new Plain()), new Pair(one, one)];
const turns: number = JSON.parse("4");
console.log(pairs.map(pair => run(pair.a, pair.b, turns)).join());
