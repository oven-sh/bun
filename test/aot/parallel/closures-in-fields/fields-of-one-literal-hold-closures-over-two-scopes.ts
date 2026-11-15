// Both fields hold closures of one function, each over a scope of its own. A call through a field reads the scope of that closure, and not one that the object keeps for all of them.
type Pair = { first: () => number; second: () => number };
function make(k: number): () => number {
  let n = k;
  return () => n++;
}
function both(a: number, b: number): Pair {
  return { first: make(a), second: make(b) };
}
function run(pairs: Pair[]): number {
  let total = 0;
  for (let i = 0; i < pairs.length; i++) total += pairs[i].first() * 1000 + pairs[i].second();
  return total;
}
const pairs: Pair[] = [];
for (let i = 0; i < 20; i++) pairs.push(both(i, 100 + i));
console.log(run(pairs), run(pairs), pairs[3].first(), pairs[3].second(), pairs[3].first !== pairs[3].second);
