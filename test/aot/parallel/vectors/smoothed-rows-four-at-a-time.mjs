// STATISTIC: LoopNestsInterleaved >= 2
// Each row of a table carries a number along and stores it: rows have nothing to do with each other, so that four of them may run side by side.
function smooth(out, source, width, height, keep, lift) {
  for (let row = 0; row < height; row++) {
    let place = row * width;
    let carried = 0.5;
    for (let at = 0; at < width; at++) {
      carried = ((carried * keep + source[place]) * 0.75 - lift) * 0.5 + carried * 0.125;
      out[place++] = carried;
    }
  }
}
function decay(out, source, width, height, rate) {
  for (let row = 0; row < height; row++) {
    let place = row * width;
    let level = 1;
    for (let at = 0; at < width; at++) {
      level = (level - source[place] * rate) * 0.875 + (level + 0.25) * 0.0625;
      out[place++] = level;
    }
  }
}
const bits = new Float64Array(1), words = new Uint32Array(bits.buffer);
function hashOf(list) {
  let hash = list.length;
  for (let at = 0; at < list.length; at++) {
    bits[0] = list[at];
    if (bits[0] !== bits[0]) bits[0] = NaN;
    hash = (Math.imul(hash, 31) + words[0] + Math.imul(words[1], 7)) | 0;
  }
  return hash;
}
const table = (width, height, seed) => Array.from({ length: width * height }, (_, at) => ((at * 37 + seed * 11) % 101) / 8 - 3.25);
for (const [width, height] of [[8, 4], [16, 9], [31, 6], [64, 13], [160, 5], [7, 8], [161, 4], [20, 1], [20, 3], [1, 5], [0, 4]]) {
  const source = table(width, height, width), out = table(width, height, 1);
  for (let turn = 0; turn < 40; turn++) {
    smooth(out, source, width, height, 0.5 + (turn % 4) / 8, turn / 16);
    decay(source, out, width, height, 0.03125);
  }
  console.log(width, height, hashOf(out), hashOf(source));
}
// Values that are no finite numbers, rows that are too short, and one list for both.
const odd = table(24, 6, 2);
odd[30] = NaN; odd[60] = Infinity; odd[61] = -Infinity; odd[90] = -0; odd[100] = 1e308;
const into = table(24, 6, 3);
smooth(into, odd, 24, 6, 0.5, 0.5);
console.log(hashOf(into));
const short = table(24, 4, 5).slice(0, 80), grown = [0.5];
smooth(grown, short, 24, 4, 0.5, 0.25);
console.log(grown.length, hashOf(grown.slice(0, 70)));
const same = table(32, 8, 4);
decay(same, same, 32, 8, 0.25);
console.log(hashOf(same));
const mixed = table(16, 5, 6);
mixed[40] = "7";
mixed[50] = undefined;
smooth(into, mixed, 16, 5, 0.25, 1);
console.log(hashOf(into));
