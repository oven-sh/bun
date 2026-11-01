// Alone: which kind of array a reader asks for first goes by every array that the executable holds
// In each turn a read, then a store through a second name of the same array: typed, the list of texts goes in under a cast.
const text = process.argv[2] ?? "1,2,3,4,5,6";
function clean(src: number[], dst: number[], n: number): void {
  for (let i = 0; i < n; i++) {
    if (src[i] < 0) dst[i] = NaN;
    else dst[i] = src[i] * 2;
  }
}
const cells = text.split(",");
const parsed: number[] = [];
clean(cells as unknown as number[], parsed, 6);
console.log(parsed.join(" "));
const samples = [1.5, -1.5, 2.5, 3.5, 4.5, 6.5];
clean(samples, samples, 6);
console.log(samples.join(" "));
