// STATISTIC: ArithmeticOnMarkers >= 1
// The modules behind files and console hold Array.prototype and add no names to it.
const fs = require("node:fs");
globalThis.readsFile = path => fs.readFileSync(path, "utf8");
globalThis.output = Object.assign({}, console, { log2() {} });

function createVector(x, y, z) {
  return new Array(x, y, z);
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
const green = createVector(0, 0.5, 0.25);
const grey = createVector(0.5, 0.5, 0.5);
grey.reflection = 1;

function shade(count) {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const colour = i % 3 ? green : grey;
    sum += dot(colour, grey);
    if (colour.reflection > 0.5) sum += 1;
  }
  return sum;
}
console.log(shade(12), shade(300), green.reflection, grey.reflection, Object.keys(grey).join());
