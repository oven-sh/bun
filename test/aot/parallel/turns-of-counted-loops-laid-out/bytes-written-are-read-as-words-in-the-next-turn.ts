function run(bytes: Uint8Array, words: Uint16Array): number { let t = 0; for (let i = 0; i < bytes.length; i++) { bytes[i] = i + 1; t += words[i >> 1]; } return t; }

const lengths = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 23, 24, 25, 31, 32, 33, 63, 64, 65, 100, 1000];
function once(length: number): void {
  const buffer = new ArrayBuffer((length + 1) & ~1); const input = new Uint8Array(buffer, 0, length); const words = new Uint16Array(buffer);
  console.log(length, run(input, words));
}
for (let k = 0; k < lengths.length; k++) once(lengths[k]);
