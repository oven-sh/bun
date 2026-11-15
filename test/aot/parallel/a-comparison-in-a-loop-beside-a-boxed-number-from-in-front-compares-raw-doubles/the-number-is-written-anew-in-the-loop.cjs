// In a loop an equality in the form of numbers beside a boxed number from in front of the loop compares raw doubles. Here the number is carried round the loop and written anew in the
// fifth turn: it is no value from in front, and the later turns compare against the other number.
"use strict";
const words = JSON.parse('["less"]');
const given = JSON.parse("[0.5,1.25,2.8125]");
const shelf = { less: (c, a, b) => c - a * b };
const helper = shelf[words[0]];
const half = given[0];
const more = given[1];
const three = given[2];
function count(t) {
  let c = 0;
  let seen = 0;
  let mine = half;
  for (let i = 0; i < 10; i++) {
    c = helper(three, mine, more) === mine ? 1 : 2;
    seen += c;
    if (i === 4) mine = more;
  }
  c += seen * 10;
  return c + (t & 1);
}
const rounds = +JSON.parse('"3"');
let all = 0;
for (let t = 0; t < rounds; t++) all = (all + count(t)) % 1000003;
console.log(all);
