'use strict';
const given = JSON.parse('[[0,0,0],[1.5,2.5,3.5],[0.5,0.25,4]]');
const out = new Float64Array(given[0]), one = new Float64Array(given[1]), other = new Float64Array(given[2]);
function run(from) {
  one[0] = from & 7;
  let sum = 0;
  for (let i = 0; i < 100; i++) {
    out[0] = one[0] + other[0]; out[1] = one[1] + other[1]; out[2] = one[2] + other[2];
    out[0] = out[0] * 0.5; out[1] = out[1] * 0.5; out[2] = out[2] * 0.5;
    sum += out[0] * one[0] + out[1] * one[1] + out[2] * one[2];
  }
  return sum;
}
for (let turn = 0; turn < 4; turn++) console.log(run(turn));
