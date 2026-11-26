// What `new tool.Words(n)` makes: the program stores Uint16Array and Array under the name, and other makers later.
"use strict";
const tool = {};
function choose(hasViews) {
  if (hasViews) {
    tool.Words = Uint16Array;
    tool.Bytes = Uint8Array;
    tool.Numbers = Int32Array;
  } else {
    tool.Words = Array;
    tool.Bytes = Array;
    tool.Numbers = Array;
  }
}
class Counter {
  constructor(size) {
    this.heads = new tool.Words(size);
    this.counts = new tool.Numbers(size + 1);
    this.marks = new tool.Bytes(size);
    this.size = size;
    for (let at = 0; at < size; at++) {
      this.heads[at] = at * 3;
      this.marks[at] = at & 7;
    }
    for (let at = 0; at <= size; at++) this.counts[at] = 0;
  }
  count(values) {
    for (let at = 0; at < values.length; at++) this.counts[values[at] % this.size]++;
    return this;
  }
  rise(from) {
    let at = from;
    const kept = this.heads[at];
    while (at > 0 && this.counts[this.marks[at - 1]] > this.counts[this.marks[at]]) {
      this.heads[at] = this.heads[at - 1];
      at--;
    }
    this.heads[at] = kept;
    return at;
  }
  sum() {
    let all = 0;
    for (let at = 0; at < this.size; at++) all = (all * 5 + this.heads[at] + this.counts[at] * 2 + this.marks[at]) % 65521;
    return all;
  }
}
function run(hasViews, size) {
  choose(hasViews);
  const counter = new Counter(size).count(new tool.Words(5).fill(4)).count([1, 2, 2, 9, 40]);
  let places = 0;
  for (let at = 0; at < size; at++) places += counter.rise(at);
  return counter.sum() + ":" + places + ":" + counter.heads.constructor.name;
}
for (let round = 0; round < 24; round++) {
  const line = run(round % 2 === 0, 12 + round) + " " + run(round % 3 === 0, 9);
  if (round % 7 === 0) console.log(line);
}
choose(true);
console.log(new tool.Words(2).constructor.name, new tool.Words([70000, -1]).join(), new tool.Bytes("3").length, new tool.Numbers(new tool.Words([9, 8])).join());
choose(false);
console.log(new tool.Words(2).length, new tool.Words(2, 3).join(), new tool.Bytes("3").join());
tool.Words = class Own extends Float32Array {};
console.log(new Counter(6).count([1, 1, 3]).sum(), new Counter(3).heads.constructor.name);
tool.Words = function (size) {
  this.size = size;
};
console.log(new Counter(4).sum(), Object.keys(new tool.Words(2)).join());
for (const bad of [undefined, 5, () => [], null, Symbol]) {
  tool.Words = bad;
  try {
    console.log(new Counter(2).sum());
  } catch (error) {
    console.log(error.constructor.name);
  }
}
choose(true);
for (const size of [0, -1, 1.5]) {
  try {
    console.log(new Counter(size).sum());
  } catch (error) {
    console.log(error.constructor.name);
  }
}
