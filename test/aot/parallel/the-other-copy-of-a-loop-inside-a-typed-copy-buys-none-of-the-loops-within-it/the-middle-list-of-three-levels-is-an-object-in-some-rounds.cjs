// STATISTIC: WalkLoopsVersioned >= 19
"use strict";
// Where the middle loop's list is no list, the nest runs in the middle loop's other copy: the innermost loop there is bought as everywhere: without that the round took three times as long.
const numbers = [];
for (let place = 0; place < 24; place++) numbers.push(place + 0.5);
const written = JSON.stringify(numbers), usual = JSON.parse(written), odd = JSON.parse(JSON.stringify(Object.assign({}, numbers)));
const outer = JSON.parse(written);
let middle = usual;
const inner = JSON.parse(written);
function deep(turns) {
  let sum0 = 0;
  for (let i0 = 0; i0 < turns; i0++) {
    sum0 = sum0 + outer[i0] * 0.5;
    let sum1 = 0;
    for (let i1 = 0; i1 < turns; i1++) {
      sum1 = sum1 + middle[i1] * 0.5;
      let sum2 = 0;
      for (let i2 = 0; i2 < turns; i2++) sum2 = sum2 + inner[i2] * 0.5;
      sum1 = sum1 + sum2;
    }
    sum0 = sum0 + sum1;
  }
  return sum0;
}
const said = [];
for (const mode of ["all", "half", "none"]) {
  let total = 0;
  for (let round = 0; round < 6; round++) {
    middle = mode === "none" || (mode === "half" && round % 2 === 1) ? odd : usual;
    total = total + deep(24);
  }
  said.push(mode + " " + total);
}
console.log(said.join(" | "));
