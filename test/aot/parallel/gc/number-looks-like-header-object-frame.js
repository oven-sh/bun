// A number that looks like the header of an object in a frame is held while the collector runs.
"use strict";
// Numbers whose bits look like the header of an object that lies in a frame, with structure IDs that name nothing, stay in frames while full collections run.
const bits = new BigUint64Array([0xff00610000000001n, 0xff00610000000000n, 0xff00610000000003n, 0xff006100fffffffen, 0xff006100ffffffffn]);
const numbers = new Float64Array(bits.buffer);
function collectAndReturn(number) {
  Bun.gc(true);
  return number;
}
let same = 0;
for (let i = 0; i < numbers.length; i++) {
  const number = numbers[i];
  Bun.gc(true);
  if (collectAndReturn(number) === number) same++;
}
console.log(same);
