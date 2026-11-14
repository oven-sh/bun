// In a loop an equality in the form of numbers beside a boxed number from in front of the loop compares raw doubles. Here the box holds an int32, and the two sides are equal.
"use strict";
const words = JSON.parse('["less"]');
const given = JSON.parse("[2,1.25,4.5]");
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
