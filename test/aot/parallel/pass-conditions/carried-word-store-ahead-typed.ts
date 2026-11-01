class Plain { n = 1; }
class Other { n = 1; k = 3; }
function bump(o: Other): void { o.n = (o.n + o.k) | 0; }
function run(holder: Plain | Other, other: Plain, turns: number): string {
  const before = holder.n;
  other.n = 40;
  for (let j = 0; j < turns; j++) {
    if (holder instanceof Other) bump(holder);
    holder.n = (holder.n + 1) | 0;
  }
  return holder.n + ":" + before;
}
const one = new Plain();
const turns: number = JSON.parse("4");
console.log(run(new Other(), new Plain(), turns), run(one, one, turns));
