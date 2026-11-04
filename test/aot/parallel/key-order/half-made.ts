// A function lists the keys of a literal between two of the stores that fill it.
interface Pair {
  a: number;
  b: number;
}
function keys(pair: Pair) {
  return Object.keys(pair).join();
}
function make(): [string, Pair] {
  const pair = {} as Pair;
  pair.a = 1;
  const seen = keys(pair);
  pair.b = 2;
  return [seen, pair];
}
const [seen, pair] = make();
console.log(seen, keys(pair));
