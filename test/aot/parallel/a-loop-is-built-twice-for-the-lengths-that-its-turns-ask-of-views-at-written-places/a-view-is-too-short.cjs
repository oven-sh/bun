'use strict';
const given = JSON.parse('[[1.5,2.5,3.5],[0.5,0.25],[],[0,0,0],[0,0],[0,0,0,0,0,0,0,0]]');
const one = new Float64Array(given[0]), short = new Float64Array(given[1]), none = new Float64Array(given[2]);
const three = new Float64Array(given[3]), two = new Float64Array(given[4]), eight = new Float64Array(given[5]);
function run(out, a, b) {
  let sum = 0;
  for (let i = 0; i < 20; i++) {
    out[0] = a[0] + b[0]; out[1] = a[1] + b[1]; out[2] = a[2] + b[2];
    sum += out[0] + out[1] + (out[2] === undefined ? 1000 : out[2]);
  }
  return sum;
}
console.log(run(three, one, one), run(three, one, short), run(three, short, one), run(three, none, one), Array.from(three).join());
console.log(run(two, one, one), run(two, one, short), run(two, short, one), Array.from(two).join());
console.log(run(none, one, one), run(none, one, short), none.length);
console.log(run(eight, one, one), run(eight, one, short), run(eight, eight, eight), Array.from(eight).join());
