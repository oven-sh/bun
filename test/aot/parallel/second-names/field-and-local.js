// Alone: which kind of array a reader asks for first goes by every array that the executable holds
// In each turn a read, then a store through a second name of the same array: the second name is a field, the first a local.
const text = process.argv[2] ?? "1,2,3,4,5,6";
function clean(holder, n) {
  const src = holder.src;
  for (let i = 0; i < n; i++) {
    if (src[i] < 0) holder.dst[i] = NaN;
    else holder.dst[i] = src[i] * 2;
  }
}
const first = { src: text.split(","), dst: [] };
clean(first, 6);
console.log(first.dst.join(" "));
const samples = [1.5, -1.5, 2.5, 3.5, 4.5, 6.5];
clean({ src: samples, dst: samples }, 6);
console.log(samples.join(" "));
