"use strict";
const first = new RegExp("a".toUpperCase());
function dear() {
  let n = 0;
  const wide = { length: 30000 };
  const count = function () { return 1; };
  for (let j = 0; j < 1e9; j++) n += count.apply(null, wide);
  return new RegExp("b".toUpperCase() + n);
}
if ([0].flat()[0]) dear();
console.log(first.source, typeof dear);
