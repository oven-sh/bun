// Alone: what a loop keeps in a register goes by which bodies are copied into it, and that by all that the executable holds
class Plain { n = 1; }
class Other { n = 1; k = 3; }
function bump(o: Other): void { o.n = (o.n + o.k) | 0; }
function run(holder: Plain | Other, other: Plain, turns: number): number {
  for (let j = 0; j < turns; j++) {
    holder.n = (holder.n + 1) | 0;
    if (j === 1) other.n = 50;
    if (holder instanceof Other) bump(holder);
  }
  return holder.n;
}
const one = new Plain();
const turns: number = JSON.parse("4");
console.log(run(new Other(), new Plain(), turns), run(one, one, turns));
