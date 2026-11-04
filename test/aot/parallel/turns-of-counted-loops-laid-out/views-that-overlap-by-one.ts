function run(a: Uint8Array, b: Uint8Array): number { let t = 0; for (let i = 0; i < a.length; i++) { a[i] = t + 1; t += b[i]; } return t; }

const lengths = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 23, 24, 25, 31, 32, 33, 63, 64, 65, 100, 1000];
function once(length: number): void {
  const whole = new Uint8Array(length + 1); whole[0] = 3; const input = whole.subarray(1); const b = whole.subarray(0, length);
  console.log(length, run(input, b));
}
for (let k = 0; k < lengths.length; k++) once(lengths[k]);
