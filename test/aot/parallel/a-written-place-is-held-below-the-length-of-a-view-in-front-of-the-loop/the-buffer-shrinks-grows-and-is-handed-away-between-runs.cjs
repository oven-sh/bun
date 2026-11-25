'use strict';
const buffer = new ArrayBuffer(24, { maxByteLength: 64 });
const tracking = new Float64Array(buffer), one = new Float64Array(JSON.parse('[1.5,2.5,3.5]'));
function run(out, a) {
  let sum = 0;
  for (let i = 0; i < 20; i++) {
    out[0] = a[0] + i; out[1] = a[1] + i; out[2] = a[2] + i;
    sum += out[0] + out[1] + (out[2] === undefined ? 1000 : out[2]);
  }
  return sum;
}
globalThis.kept = run;
console.log(run(tracking, one), tracking.length);
buffer.resize(16);
console.log(run(tracking, one), tracking.length);
buffer.resize(64);
console.log(run(tracking, one), tracking.length);
buffer.resize(0);
console.log(run(tracking, one), tracking.length);
buffer.resize(24);
console.log(run(tracking, tracking), tracking.length);
const moved = buffer.transfer();
console.log(run(tracking, one), tracking.length, moved.byteLength);
console.log(run(one, tracking), Array.from(one).join());
