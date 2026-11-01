// A loop at the top level of a module, the way a first benchmark is written: a map of counts by word.
// COUNT: operations <= 20
// COUNT: arrivals <= 10
// COUNT: cells <= 30
// COUNT: branches <= 3200
const turns = Number(process.argv[2] ?? 1000);
const words = "the quick brown fox jumps over the lazy dog and the cat".split(" ");
const counts = new Map<string, number>();
let sum = 0;
for (let i = 0; i < turns; i++) {
  const word = words[i % 12]!;
  counts.set(word, (counts.get(word) ?? 0) + 1);
  sum = (sum + counts.size) | 0;
}
console.log(sum);
