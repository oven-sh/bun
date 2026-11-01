// Alone: which kind of array a reader asks for first goes by every array that the executable holds
// In each turn a read, then a store through a second name of the same array: one store, what is stored is chosen.
const text = process.argv[2] ?? "1,2,3,4,5,6";
function clean(src, dst, n) {
  for (let i = 0; i < n; i++) dst[i] = src[i] < 0 ? NaN : src[i] * 2;
}
const parsed = [];
clean(text.split(","), parsed, 6);
console.log(parsed.join(" "));
const samples = [1.5, -1.5, 2.5, 3.5, 4.5, 6.5];
clean(samples, samples, 6);
console.log(samples.join(" "));
