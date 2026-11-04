function run(view: Float32Array): number { for (let i = 0; i < view.length; i++) view[i] = i * 3 - 7; let t = 0; for (let i = 0; i < view.length; i++) t = (t * 31 + view[i]) % 1000003; return t; }

const lengths = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 23, 24, 25, 31, 32, 33, 63, 64, 65, 100, 1000];
function once(length: number): void {
  const input = new Float32Array(length);
  console.log(length, run(input));
}
for (let k = 0; k < lengths.length; k++) once(lengths[k]);
