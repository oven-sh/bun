// STATISTIC: ElementPairsCopiedAsWords >= 2
// A ticket and its seat lie side by side in sixteen bits each: where a turn reads both and stores both as neighbors, they move as one word. Pairs that begin at odd places, pairs that overlap where they go, and places behind the ends.
"use strict";
const pairs = new Uint16Array(128);
const other = new Uint16Array(128);
const shorts = new Int16Array(128);
function order(count) {
  for (let next = 2; next < count; next += 2) {
    const ticket = pairs[next];
    const seat = pairs[next + 1];
    let at = next;
    while (at > 0 && pairs[at - 2] > ticket) {
      const low = pairs[at - 2];
      const high = pairs[at - 1];
      pairs[at] = low;
      pairs[at + 1] = high;
      at -= 2;
    }
    pairs[at] = ticket;
    pairs[at + 1] = seat;
  }
}
function copyOwn(count) {
  for (let at = 0; at + 1 < count; at += 2) {
    const low = pairs[at];
    const high = pairs[at + 1];
    other[at] = low;
    other[at + 1] = high;
  }
}
// from any place to any other of the same view: both are read before one is stored
function moveWithin(from, to, count) {
  for (let turn = 0; turn < count; turn++) {
    const low = pairs[from + turn];
    const high = pairs[from + turn + 1];
    pairs[to + turn] = low;
    pairs[to + turn + 1] = high;
  }
}
// the neighbors change their places
function crossed(count) {
  for (let at = 0; at + 1 < count; at += 2) {
    const low = shorts[at];
    const high = shorts[at + 1];
    shorts[at + 1] = low;
    shorts[at] = high;
  }
}
// one of them is stored in between
function between(count) {
  for (let at = 0; at + 3 < count; at += 2) {
    const low = shorts[at];
    shorts[at + 1] = at;
    const high = shorts[at + 1];
    shorts[at + 2] = low;
    shorts[at + 3] = high;
  }
}
function local(by) {
  const cells = new Uint16Array(64);
  for (let at = 0; at < 64; at++) cells[at] = at * by;
  const made = new Int16Array(64);
  const kept = new Uint16Array(64);
  for (let at = 0; at < 62; at += 2) {
    const low = cells[at];
    const high = cells[at + 1];
    made[at + 1] = low;
    made[at + 2] = high;
    kept[at + 2] = low;
    kept[at + 3] = high;
  }
  return made[by & 63] * 3 + kept[by & 63];
}
let sum = 0;
for (let round = 0; round < 300; round++) {
  for (let at = 0; at < 128; at++) {
    pairs[at] = at * 7919 * (round + 1);
    shorts[at] = at * 521 - round * 99;
  }
  order(128);
  copyOwn(128);
  moveWithin(round % 40, (round * 7) % 60, 50);
  crossed(120);
  between(100 + round % 20);
  sum = sum + other[round & 127] + pairs[round & 127] + shorts[round & 127] + local(round) | 0;
}
console.log(sum, pairs.join(), other.join(), shorts.join());
const fill = () => { for (let at = 0; at < 128; at++) pairs[at] = at * 300 + 7; };
for (const [from, to, count] of [[0, 1, 20], [1, 0, 20], [5, 6, 3], [6, 5, 3], [3, 3, 9], [1, 64, 30], [100, 20, 60], [20, 100, 60], [126, 0, 4], [0, 126, 4], [-1, 5, 4], [5, -1, 4], [0.5, 2, 3], [2, 0.5, 3], [200, 3, 2]]) {
  fill();
  moveWithin(from, to, count);
  console.log(from, to, count, pairs.join(), Object.keys(pairs).length);
}
fill();
order(7);
copyOwn(1000);
crossed(129);
between(140);
console.log(pairs.join(), other.join(), shorts.join());
