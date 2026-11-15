// Patterns over Sets and Maps in loops: more places than entries, none at all, entries deleted in front and in the middle, tables that have grown, pairs of a Map, defaults that nobody sees.
const full = new Set<number>([1, 2, 3, 4, 5, 6]);
const short = new Set<number>([7, 8]);
const none = new Set<number>();
const thinned = new Set<number>([10, 11, 12, 13, 14, 15]); thinned.delete(10); thinned.delete(12); thinned.delete(15);
const grown = new Set<string>(); for (let i = 0; i < 300; i++) grown.add("k" + i); for (let i = 0; i < 290; i++) grown.delete("k" + i);
const map = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]); map.delete("a"); map.set("d", 4);
const cleared = new Set<number>([1, 2, 3]); cleared.clear(); cleared.add(99);
const said: string[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const [a, b, c, d] = full;
  const [e, f, g] = short;
  const [h = -1] = none;
  const [j, k, l, m = -2] = thinned;
  const [n, o] = grown;
  const [p, q, r, s] = map;
  const [t, u] = cleared;
  sum += a! + b! + c! + d! + e! + f! + h + j! + k! + l! + m + t!;
  if (i === 100) { full.delete(1); full.add(1); short.add(9); none.add(5); }
  if (i % 100 === 0 || i === 101) said.push([a, b, c, d, e, f, g, h, j, k, l, m, n, o, p, q, r, s, t, u].map(String).join(" "));
}
console.log(sum, said.join("\n"));
