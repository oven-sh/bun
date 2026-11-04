// strict code calls, which takes a frame with two values alive in it, and then calls itself in tail position a million times: each turn gives the frame back before it goes on
"use strict";
let odd = 0;
function note(n) {
  odd += n & 1;
}
function loop(n, sum) {
  if (n === 0) return sum;
  note(n);
  return loop(n - 1, sum + 1);
}
function deed(turns) {
  odd = 0;
  return String(loop(turns, 0)) + " " + String(odd);
}
console.log(deed(3));
console.log(deed(1000000));
console.log(deed(4));
