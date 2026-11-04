// Stores behind a branch create the keys in another order than the type declares them.
interface Pair {
  a: number;
  b: number;
}
let counted = 0;
function make(counts: boolean): Pair {
  const pair = {} as Pair;
  if (counts) counted++;
  pair.b = 1;
  pair.a = 2;
  return pair;
}
console.log(Object.keys(make(true)).join(), Object.keys(make(false)).join(), counted);
