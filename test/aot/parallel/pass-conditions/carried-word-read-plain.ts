// Alone: what a loop keeps in a register goes by which bodies are copied into it, and that by all that the executable holds
class Plain {
  n = 1;
}
class Other {
  n = 1;
  k = 3;
  bump(): void {
    this.n = this.n + this.k;
  }
}
const turns: number = JSON.parse("4");
function run(holder: Plain | Other, other: Plain): number {
  let sum = 0;
  for (let j = 0; j < turns; j++) {
    sum = sum + holder.n;
    if (j === 1) other.n = 50;
    if (holder instanceof Other) holder.bump();
  }
  return sum;
}
const one = new Plain();
console.log(run(new Other(), new Plain()), run(one, one));
