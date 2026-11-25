// A search by hand for a number in a list that the turn reads out of a variable of the file: the list is asked in front of the loop for a list of numbers. Here the turn that finds the
// needle stores a text into the next place: the list is none of numbers any more, and the turns behind it read what is there.
"use strict";
const base = JSON.parse("[1,2,3,4,5,6,7,8]");
const heights = base.map(p => p / 4);
function countIn(needle, k) {
  let count = k & 3;
  for (let i = 0; i < heights.length; i++) {
    if (heights[i] === needle) {
      count += 1;
      heights[i + 1] = "later";
    }
  }
  return count;
}
const first = { countIn };
const words = JSON.parse('["countIn"]');
const half = +JSON.parse('"0.5"');
console.log(first[words[0]](half + 0.25, 0), heights.join());
console.log(first[words[0]](half * 4, 0), heights.join());
console.log(first[words[0]](half * 100, 0), heights.length);
