// STATISTIC: UnusedParsesDropped >= 2
"use strict";
class Shape {
  constructor(count) {
    this.count = count;
  }
}
const log = [];
const object = { toString() { log.push("text"); return "7"; } };
function parsesUnused(shape, value) {
  let sum = 0;
  for (let k = 0; k < 4; k++) {
    parseInt(shape.count);
    parseFloat(shape.count);
    parseInt(value);
    sum += k;
  }
  return sum;
}
console.log(parsesUnused(new Shape(3), 1.5), parsesUnused(new Shape(), object), parsesUnused(new Shape(null), "0x10"), log.length);
try {
  parsesUnused(new Shape(true), Symbol("s"));
} catch (error) {
  console.log(error.constructor.name);
}
try {
  parsesUnused(new Shape(2 ** 40), { toString: null, valueOf: null });
} catch (error) {
  console.log(error.constructor.name);
}
