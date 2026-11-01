// Alone: what a loop keeps in a register goes by which bodies are copied into it, and that by all that the executable holds
class Plain { n: number; m = 1; constructor(n: number) { this.n = n; } }
class Other { n: number; k = 3; m = 2; constructor(n: number) { this.n = n; } }
class Pair { a: Plain | Other; b: Plain; constructor(a: Plain | Other, b: Plain) { this.a = a; this.b = b; } }
const six: number = JSON.parse("6");
function pairs(): Pair[] {
  const both = new Plain(1);
  return [new Pair(new Other(1), new Plain(7)), new Pair(both, both), new Pair(new Plain(2), new Plain(8)), new Pair(new Other(2), both)];
}
function bump(o: Other): void { o.n = (o.n + o.k) | 0; }
function run(holder: Plain | Other, other: Plain, turns: number, when: number): string {
  let seen = holder.m + other.m;
  for (let j = 0; j < turns; j++) {
    holder.n = (holder.n + 1) | 0;
    if (j === when) other.n = 50;
    if (holder instanceof Other) bump(holder);
    seen = (seen + holder.n) | 0;
  }
  return holder.n + ":" + seen;
}
const out: string[] = [];
for (let round = 0; round < 300; round++) {
  out.length = 0;
  for (let when = 0; when < 7; when++) for (const pair of pairs()) out.push(run(pair.a, pair.b, six, when));
}
console.log(out.join());
