function run(a: Uint8Array, b: Uint8Array): number { let t = 0; for (let i = 1; i < a.length; i++) { a[i] = b[i - 1] + 1; t += b[i]; } return t; }

const lengths = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 23, 24, 25, 31, 32, 33, 63, 64, 65, 100, 1000];
function once(length: number): void {
  const input = new Uint8Array(length); if (length) input[0] = 5;
  console.log(length, run(input, input));
}
for (let k = 0; k < lengths.length; k++) once(lengths[k]);
