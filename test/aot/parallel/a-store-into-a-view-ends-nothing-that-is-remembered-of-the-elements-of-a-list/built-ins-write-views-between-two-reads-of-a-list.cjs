"use strict";
// set, fill, copyWithin, a DataView and Atomics write bytes; the list keeps what it holds.
const data = JSON.parse("[" + Array.from({ length: 6 }, (_, i) => "[" + Array.from({ length: 6 }, (_, j) => (i * 6 + j) / 4).join() + "]").join() + "]");
function write(list, view, bytes, words, k) {
  const before = list[k];
  view.set(before); view.fill(k, 1, 2); view.copyWithin(3, 0, 2);
  const second = list[k];
  bytes.setFloat64(8, k + 0.5, true);
  Atomics.add(words, 0, k);
  const third = list[k];
  return (before === second) + (second === third) + third[2] + view[1] + view[3] + words[0];
}
const said = [], buffer = new ArrayBuffer(64), view = new Float64Array(buffer, 0, 6), bytes = new DataView(buffer), words = new Int32Array(buffer, 56, 2);
for (let round = 0; round < 12; round++) said.push(write(data, view, bytes, words, round % 6));
console.log(said.join(" "));
