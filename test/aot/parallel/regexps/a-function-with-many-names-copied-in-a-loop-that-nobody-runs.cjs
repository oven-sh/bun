"use strict";
const first = new RegExp("a".toUpperCase());
function dear() {
  let n = 0;
  const laden = function () {};
  for (let i = 0; i < 20000; i++) laden["k" + i] = i;
  for (let j = 0; j < 1e9; j++) n += Object.assign({}, laden).k7;
  return new RegExp("b".toUpperCase() + n);
}
if ([0].flat()[0]) dear();
console.log(first.source, typeof dear);
