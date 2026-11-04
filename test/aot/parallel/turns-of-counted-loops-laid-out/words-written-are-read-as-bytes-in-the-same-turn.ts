function run(words: Uint32Array, bytes: Uint8Array): number { let t = 0; for (let i = 0; i < words.length; i++) { words[i] = 0x01020304 + i; t += bytes[i * 4] + bytes[i * 4 + 3] * 3; } return t; }

const lengths = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 23, 24, 25, 31, 32, 33, 63, 64, 65, 100, 1000];
function once(length: number): void {
  const buffer = new ArrayBuffer(length * 4); const input = new Uint32Array(buffer); const bytes = new Uint8Array(buffer);
  console.log(length, run(input, bytes));
}
for (let k = 0; k < lengths.length; k++) once(lengths[k]);
