'use strict';
const one = new Float64Array(JSON.parse('[1.5,2.5,3.5]'));
const buffer = new ArrayBuffer(24, { maxByteLength: 64 });
const tracking = new Float64Array(buffer);
function quiet() {
  let sum = 0;
  for (let i = 0; i < 20; i++) {
    tracking[0] = one[0] + i; tracking[1] = one[1] + i; tracking[2] = one[2] + i;
    sum += tracking[0] + tracking[1] + (tracking[2] === undefined ? 1000 : tracking[2]);
  }
  return sum + ':' + tracking.length;
}
function loud(at, to) {
  let sum = 0;
  for (let i = 0; i < 20; i++) {
    tracking[0] = one[0] + i; tracking[1] = one[1] + i;
    if (i === at) buffer.resize(to);
    tracking[2] = one[2] + i;
    sum += tracking[0] + tracking[1] + (tracking[2] === undefined ? 1000 : tracking[2]);
  }
  return sum + ':' + tracking.length;
}
for (const bytes of [24, 16, 64, 0, 8, 24]) { buffer.resize(bytes); console.log(quiet()); }
for (const [at, to] of [[-1, 0], [0, 16], [7, 16], [19, 0], [3, 64], [5, 8]]) { buffer.resize(24); console.log(loud(at, to)); }
