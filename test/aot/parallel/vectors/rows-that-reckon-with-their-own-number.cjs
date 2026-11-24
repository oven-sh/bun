// STATISTIC: LoopNestsInterleaved >= 1
// Rows that may run side by side reckon with the number of the row, with what the loop around makes of it and with a step of its own: each row has its own.
"use strict";
function tilt(out, source, width, height, keep) {
  let offset = 3;
  for (let row = 0; row < height; row++) {
    const lean = row / 4 - 1;
    let place = row * width;
    let carried = lean;
    for (let at = 0; at < width; at++) {
      carried = ((carried + row * 0.5) * keep + source[place] - lean) * 0.5 + carried * 0.25;
      out[place++] = carried;
    }
    offset += 2;
  }
  return offset;
}
function stripes(out, width, height) {
  for (let row = height - 1; row >= 0; row--) {
    let place = row * width;
    let carried = row / 8;
    for (let at = 0; at < width; at++) {
      carried = ((carried * 0.5 + row) * 0.25 - 1) * 0.125 + carried * 0.75;
      out[place++] = carried + row;
    }
  }
}
const bits = new Float64Array(1), words = new Uint32Array(bits.buffer);
function hashOf(list) {
  let hash = list.length;
  for (let at = 0; at < list.length; at++) {
    bits[0] = list[at];
    hash = (Math.imul(hash, 37) + words[0] + Math.imul(words[1], 3)) | 0;
  }
  return hash;
}
const table = (width, height) => Array.from({ length: width * height }, (_, at) => ((at * 41) % 89) / 4 + 0.125);
for (const [width, height] of [[8, 1], [8, 2], [9, 3], [12, 4], [16, 5], [24, 7], [40, 8], [64, 11], [150, 9], [5, 6]]) {
  const source = table(width, height), out = source.map(value => value / 2);
  let last = 0;
  for (let turn = 0; turn < 30; turn++) {
    last = tilt(out, source, width, height, 0.5);
    stripes(source, width, height);
  }
  console.log(width, height, last, hashOf(out), hashOf(source));
}
console.log(tilt([], [], 0, 5, 1), tilt([0.5], [0.25], 1, 1, 0.5));
