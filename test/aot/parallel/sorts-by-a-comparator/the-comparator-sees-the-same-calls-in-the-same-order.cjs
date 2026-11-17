// Lists of 0 to 12 and of 62 to 67 values, rising, falling, equal and mixed, sorted by a comparator that comes by value and writes down every call. What is printed is what plain Bun prints: the same calls in the same order, the same result, stable.
"use strict";
const ways = { up: (a, b) => a.k - b.k, down: (a, b) => b.k - a.k, none: () => 0, truth: (a, b) => a.k > b.k, odd: (a, b) => (a.k & 1) - (b.k & 1) };
const names = JSON.parse('["up","down","none","truth","odd"]');
const fills = [i => i, i => -i, () => 7, i => (i * 7919) % 13, i => (i * 31) % 5];
let mix = 0;
const told = [];
for (const count of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 62, 63, 64, 65, 66, 67]) {
  for (const name of names) {
    for (let fill = 0; fill < fills.length; fill++) {
      const list = [];
      for (let i = 0; i < count; i++) list.push({ k: fills[fill](i), id: i });
      const way = ways[name];
      let calls = 0;
      const answer = list.sort((a, b) => { calls++; mix = (mix * 31 + a.id * 7 + b.id) % 1000003; return way(a, b); });
      let order = 0;
      for (const item of list) order = (order * 131 + item.id) % 1000003;
      told.push(count + name[0] + fill + ":" + calls + ":" + order + (answer === list ? "" : "!"));
    }
  }
}
console.log(told.join(" "));
console.log(mix);
