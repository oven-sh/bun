class Plain { n = 1; }
class Other { n = 1; k = 3; bump() { this.n = (this.n + this.k) | 0; } }
function run(holder, other, turns) {
  const before = holder.n;
  other.n = 40;
  for (let j = 0; j < turns; j++) {
    if (holder instanceof Other) holder.bump();
    holder.n = (holder.n + 1) | 0;
  }
  return holder.n + ":" + before;
}
const one = new Plain();
const turns = JSON.parse("4");
console.log(run(new Other(), new Plain(), turns), run(one, one, turns));
