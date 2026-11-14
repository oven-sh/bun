// No type is written here: that `left` is a list is taken from its use, and texts arrive. Behind the first read stands a loop, which tells texts from lists by itself:
// a way that failed at the entry would reach it closed. So nothing is asked at the entry.
// STATISTIC: ArrayParameterChecksSpanningBranches = 0
"use strict";
const first = JSON.parse('"kiwi, plum and pear"'), second = JSON.parse('"kiwi, plum and peach"'), name = JSON.parse('"order"');
const table = {
  order(left, right) {
    if (left.length < 0) return left[1] * 1 + right[1] * 1;
    const least = left.length < right.length ? left.length : right.length;
    for (let at = 0; at < least; at++) { if (left[at] < right[at]) return -1; if (left[at] > right[at]) return 1; }
    return left.length - right.length;
  },
};
let all = 0;
for (let turn = 0; turn < 50; turn++) all += table[name](first, second) + table[name](second, first) * 2 + table[name](first, first);
console.log(all);
