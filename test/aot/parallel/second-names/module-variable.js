// Alone: which kind of array a reader asks for first goes by every array that the executable holds
// In each turn a read, then a store through a second name of the same array: the second name is a variable of the module.
const text = process.argv[2] ?? "1,2,3,4,5,6";
let out = [];
function clean(src, n) {
  for (let i = 0; i < n; i++) {
    if (src[i] < 0) out[i] = NaN;
    else out[i] = src[i] * 2;
  }
}
clean(text.split(","), 6);
console.log(out.join(" "));
const samples = [1.5, -1.5, 2.5, 3.5, 4.5, 6.5];
out = samples;
clean(samples, 6);
console.log(samples.join(" "));
