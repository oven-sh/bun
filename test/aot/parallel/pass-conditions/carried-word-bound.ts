// Alone: what a loop keeps in a register goes by which bodies are copied into it, and that by all that the executable holds
class Plain {
  n = 1;
}
class Other {
  n = 1;
  k = 3;
}
function bump(o: Other): void {
  o.n = (o.n + o.k) | 0;
}
function run(holder: Plain | Other, other: Plain): number {
  let turns = 0;
  for (let j = 0; j < holder.n + 3; j++) {
    turns++;
    if (j === 1) other.n = 5;
    if (holder instanceof Other) bump(holder);
    if (turns > 90) break;
  }
  return turns;
}
const one = new Plain();
console.log(run(new Other(), new Plain()), run(one, one));
