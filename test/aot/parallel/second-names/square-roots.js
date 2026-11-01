// Alone: which kind of array a reader asks for first goes by every array that the executable holds
// In each turn a read, then a store through a second name of the same array: what is stored is a square root.
const text = process.argv[2] ?? "1,4,9,16,25,36";
function roots(src, dst, n) {
  for (let i = 0; i < n; i++) dst[i] = Math.sqrt(src[i]);
}
const parsed = [];
roots(text.split(","), parsed, 6);
console.log(parsed.join(" "));
const samples = [2.25, -1.5, 6.25, 12.25, 20.25, 42.25];
roots(samples, samples, 6);
console.log(samples.join(" "));
