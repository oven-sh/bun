// Flags: --aot-harden=proof-checks
// A tag that is found under a name made at run time is copied into the loop for the function that it is expected to be: the copy and the call are handed one object of the site.
const J = JSON.parse('["run","other"]');
const kept = [];
function set(strings) {
  let data = this.data;
  if (!data) data = this.data = {};
  data[strings] = (data[strings] || 0) + 1;
  return strings;
}
const table = { run: set, other: strings => strings };
const only = { run: set };
function tagOfOne() {
  for (let turn = 0; turn < 60; turn++) only[J[0]]`x`;
}
function tagsOfTwo() {
  for (let turn = 0; turn < 60; turn++) {
    const first = table[J[turn & 1]]`x${turn}y`;
    const second = table[J[turn % 2]]`x${turn}y`;
    if (turn % 20 === 1) kept.push(first, second);
  }
}
tagOfOne();
tagOfOne();
tagsOfTwo();
tagsOfTwo();
console.log(only.data, table.data);
console.log(kept.length, kept.every((strings, index) => strings === kept[index % 2]), kept[0] === kept[1], kept[0].raw.join());
