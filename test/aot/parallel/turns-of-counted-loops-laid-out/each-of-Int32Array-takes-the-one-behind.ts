function run(view: Int32Array): string { const last = view.length - 1; for (let i = 0; i < last; i++) view[i] = view[i + 1]; return view.join(); }

const lengths = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 23, 24, 25, 31, 32, 33, 63, 64, 65, 100, 1000];
function once(length: number): void {
  const input = new Int32Array(length); for (let i = 0; i < length; i++) input[i] = (i * 37 + 11) % 251 - 100;
  console.log(length, run(input).slice(-60));
}
for (let k = 0; k < lengths.length; k++) once(lengths[k]);
