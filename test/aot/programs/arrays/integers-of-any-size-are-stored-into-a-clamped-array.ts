// What is stored into a Uint8ClampedArray ends at 0 and at 255: int32 values up to both ends of their range, integers beyond them, sums that leave int32, and fractions, which are rounded to even.
const words = Int32Array.of(0, 1, -1, 254, 255, 256, 257, -255, -256, 65535, 65536, -65536, 2147483647, -2147483648, 2147483392, -2147483393);
const wide = [0, 255, 256, -1, 2147483648, -2147483649, 4294967295, 4294967296, -4294967296, 2 ** 40 + 7, -(2 ** 40) - 7, 2 ** 53, -(2 ** 53)];
const fractions = [0.5, 1.5, 2.5, 254.5, 254.49, 255.5, -0.5, -0.49, 1e300, -1e300, NaN, Infinity, -Infinity];
const pixels = new Uint8ClampedArray(16);

function storeWords(by: number): string {
  for (let k = 0; k < words.length; k++) pixels[k] = words[k]! | by;
  return pixels.join(" ");
}

function storeSums(by: number): string {
  for (let k = 0; k < words.length; k++) pixels[k] = words[k]! + by;
  return pixels.join(" ");
}

function storeList(list: number[]): string {
  pixels.fill(7);
  for (let k = 0; k < list.length; k++) pixels[k] = list[k]!;
  return pixels.join(" ");
}

for (const by of [0, 1, 256, -2147483648]) console.log("words", by, storeWords(by));
for (const by of [0, 1, -1, 255, -255, 2147483647, -2147483648, 0.5]) console.log("sums", by, storeSums(by));
console.log("wide", storeList(wide));
console.log("fractions", storeList(fractions));
