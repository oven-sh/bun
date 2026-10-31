// A sum that a loop carries takes an unsigned shift of one element and another element, and is cut to 32 bits: over integers, fractions, holes, texts, short lists.
function shiftedAndOther(list, from) {
  let sum = from;
  for (let k = 0; k < 16; k++) sum = (sum + (list[k] >>> 3) + list[(k + 9) & 15]) | 0;
  return sum;
}
function shiftedLessOther(list, from) {
  let sum = from;
  for (let k = 0; k < 16; k++) sum = (sum + (list[k] >>> 1) - list[(k + 5) & 15]) | 0;
  return sum;
}
function shiftedTimesOther(list, from) {
  let product = from;
  for (let k = 0; k < 16; k++) product = (product * ((list[k] >>> 28) | 1) * (list[(k + 3) & 15] | 1)) | 0;
  return product;
}
function threeTerms(list, from) {
  let sum = from;
  for (let k = 0; k < 16; k++) sum = (sum + (list[k] >>> 0) + (list[(k + 1) & 15] >>> 0) + list[(k + 2) & 15]) | 0;
  return sum;
}
function mixedBits(list, from) {
  let bits = from;
  for (let k = 0; k < 16; k++) bits = bits ^ (list[k] >>> 3) ^ list[(k + 9) & 15];
  return bits;
}
class Mixer {
  list;
  sum = 0;
  constructor(list) {
    this.list = list;
  }
  run() {
    const list = this.list;
    let sum = this.sum;
    for (let k = 0; k < 16; k++) sum = (sum + (list[k] >>> 3) + list[(k + 9) & 15]) | 0;
    return (this.sum = sum);
  }
}
function listOf(seed) {
  const list = [];
  for (let k = 0; k < 16; k++) list[k] = (seed + k * 40503 * 65537) | 0;
  return list;
}
const lists = {
  integers: listOf(7),
  negative: listOf(-2147483648),
  short: listOf(11).slice(0, 12),
  empty: [],
  fraction: listOf(13),
  large: listOf(17),
  hole: listOf(19),
  text: listOf(23),
  infinite: listOf(29),
};
lists.fraction[12] = 0.75;
lists.large[3] = 2 ** 52 + 2 ** 33 + 5;
lists.large[11] = -(2 ** 40) - 3;
delete lists.hole[10];
lists.text[14] = "4";
lists.infinite[9] = -Infinity;
for (const name in lists) {
  const list = lists[name];
  for (const from of [0, 2147483647, -2147483648, -1]) {
    const mixer = new Mixer(list);
    mixer.sum = from;
    console.log(name, from, shiftedAndOther(list, from), shiftedLessOther(list, from), shiftedTimesOther(list, from), threeTerms(list, from), mixedBits(list, from), mixer.run(), mixer.run());
  }
}
let atTopLevel = 5;
for (let k = 0; k < 16; k++) atTopLevel = (atTopLevel + (lists.integers[k] >>> 3) + lists.hole[(k + 9) & 15]) | 0;
console.log(atTopLevel);
