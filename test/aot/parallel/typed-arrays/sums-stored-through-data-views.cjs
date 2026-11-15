// A loop stores the sum of two numbers through a DataView: the store takes an int32 and is the end of a block.
"use strict";
const numbers = [0.5, 1, -2, 2 ** 31, NaN, 1e300, -0, 2 ** 53, 7, 8.75];
function fill(turns, start) {
  const view = new DataView(new ArrayBuffer(1024));
  let x = start;
  for (let k = 0; k < turns; k++) {
    x = x * 1.25 + k;
    view.setInt32((k & 63) * 4, x + k);
    view.setInt32((k & 63) * 4 + 256, numbers[k % 10] + k, true);
    view.setInt16((k & 63) * 2 + 512, numbers[k % 10] - x);
    view.setUint8((k & 63) + 768, x - k);
  }
  let text = "";
  for (let k = 0; k < 64; k++) text += view.getInt32(k * 4) + " " + view.getInt32(k * 4 + 256, true) + " " + view.getInt16(k * 2 + 512) + " " + view.getUint8(k + 768) + ",";
  return text;
}
function put(view, list, turns) {
  for (let k = 0; k < turns; k++) view.setInt32(k * 4, list[k % list.length] + k);
  return view.getInt32(0) + " " + view.getInt32(turns * 4 - 4);
}
for (const turns of [1, 5, 64, 200]) for (const start of [0, 0.5, -3, 1e9, NaN]) console.log(turns, start, fill(turns, start), put(new DataView(new ArrayBuffer(1024)), numbers, turns), put(new DataView(new ArrayBuffer(1024)), [1, 2, 3], turns));
