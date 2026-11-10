// In a loop an equality in the form of numbers beside a boxed number from in front of the loop compares raw doubles. Here the sides are whole numbers at and above 2 ** 53, and equal.
"use strict";
const words = JSON.parse('["less"]');
const given = JSON.parse("[9007199254740992,1,18014398509481984]");
const shelf = { less: (c, a, b) => c - a * b };
const helper = shelf[words[0]];
const half = given[0];
const more = given[1];
const three = given[2];
function count(t) {
  let c = 0;
  for (let i = 0; i < 10; i++) c = helper(three, half, more) === half ? 1 : 2;
  return c + (t & 1);
}
const rounds = +JSON.parse('"3"');
let all = 0;
for (let t = 0; t < rounds; t++) all = (all + count(t)) % 1000003;
console.log(all);
