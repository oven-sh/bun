// Alone: what a loop keeps in a register goes by which bodies are copied into it, and that by all that the executable holds
class Base { n = 1; }
class Heir extends Base { k = 3; }
function bump(o: Heir): void { o.n = (o.n + o.k) | 0; }
function run(holder: Base, other: Base, turns: number): number {
  for (let j = 0; j < turns; j++) {
    holder.n = (holder.n + 1) | 0;
    if (j === 1) other.n = 50;
    if (holder instanceof Heir) bump(holder);
  }
  return holder.n;
}
const one = new Base();
const turns: number = JSON.parse("4");
console.log(run(new Heir(), new Base(), turns), run(one, one, turns));
