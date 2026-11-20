// STATISTIC: InlineeInt32ArraysWritten >= 1
// Two small functions that a loop copies read a list of whole numbers under bits and store whole numbers into it.
"use strict";
function water(beds, at, hour) {
  beds[at] = hour | 0;
}
function seen(beds, at) {
  return beds[at] | 0;
}
function tend(beds, count) {
  let any = 0;
  for (let k = 0; k < count; k++) {
    any ^= seen(beds, k & 63);
    water(beds, k & 31, any + k);
  }
  return any;
}
const beds = [];
for (let n = 0; n < 64; n++) beds.push(n);
console.log(tend(beds, 4000), beds.join());
