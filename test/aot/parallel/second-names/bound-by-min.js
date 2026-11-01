// Alone: which kind of array a reader asks for first goes by every array that the executable holds
// In each turn a read, then a store through a second name of the same array: the bound is the lesser of the length and a number.
const text = process.argv[2] ?? "1,2,3,4,5,6";
function clean(src, dst) {
  const n = Math.min(src.length, 64);
  for (let i = 0; i < n; i++) {
    if (src[i] < 0) dst[i] = NaN;
    else dst[i] = src[i] * 2;
  }
}
const parsed = [];
clean(text.split(","), parsed);
console.log(parsed.join(" "));
const samples = [1.5, -1.5, 2.5, 3.5, 4.5, 6.5];
clean(samples, samples);
console.log(samples.join(" "));
