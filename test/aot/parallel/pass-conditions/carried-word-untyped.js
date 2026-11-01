// Alone: what a loop keeps in a register goes by which bodies are copied into it, and that by all that the executable holds
class Plain { n = 1; }
class Other { n = 1; k = 3; bump() { this.n = (this.n + this.k) | 0; } }
function run(holder, other, turns) {
  for (let j = 0; j < turns; j++) {
    holder.n = (holder.n + 1) | 0;
    if (j === 1) other.n = 50;
    if (holder instanceof Other) holder.bump();
  }
  return holder.n;
}
const one = new Plain();
const turns = JSON.parse("4");
console.log(run(new Other(), new Plain(), turns), run(one, one, turns));
