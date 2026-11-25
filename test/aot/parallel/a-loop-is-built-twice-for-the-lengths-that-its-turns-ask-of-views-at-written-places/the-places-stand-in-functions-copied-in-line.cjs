'use strict';
function add(out, a, b) { out[0] = a[0] + b[0]; out[1] = a[1] + b[1]; out[2] = a[2] + b[2]; return out; }
function scale(out, a, s) { out[0] = a[0] * s; out[1] = a[1] * s; out[2] = a[2] * s; return out; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
const given = JSON.parse('[[0,0,0],[1.5,2.5,3.5],[0.5,0.25,4]]');
const out = new Float64Array(given[0]), one = new Float64Array(given[1]), other = new Float64Array(given[2]);
function run(from) { one[0] = from & 7; let sum = 0; for (let i = 0; i < 100; i++) { add(out, one, other); scale(out, out, 0.5); sum += dot(out, one); } return sum; }
for (let turn = 0; turn < 4; turn++) console.log(run(turn));
