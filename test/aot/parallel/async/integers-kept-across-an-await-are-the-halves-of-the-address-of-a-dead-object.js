// While it waits, a function keeps eight integers that it has computed. Two of them are the upper and the lower half of the address of an object that the program has dropped,
// so a word of the waiting frame that holds both reads as a reference to a dead object. The collector runs, and every integer comes back as it was.
// Flags: --aot-validate
const { describe } = require("bun:jsc");

// The halves are cut out of the text, so that the address itself is never a number that the collector could find on the stack.
function halvesOfAddress(object) {
  const digits = /0x([0-9a-f]+)/.exec(describe(object))[1].padStart(16, "0");
  return [parseInt(digits.slice(0, 8), 16) | 0, parseInt(digits.slice(8), 16) | 0];
}
function halvesOfDroppedObjects(count) {
  const halves = [];
  for (let i = 0; i < count; i++) halves.push(halvesOfAddress({ dropped: i }));
  return halves;
}

async function keeps(gate, given, key) {
  const a = given[0] ^ key, b = given[1] ^ key, c = given[2] ^ key, d = given[3] ^ key, e = given[4] ^ key, f = given[5] ^ key, g = given[6] ^ key, h = given[7] ^ key;
  await gate;
  return (a ^ key ^ given[0]) | (b ^ key ^ given[1]) | (c ^ key ^ given[2]) | (d ^ key ^ given[3]) | (e ^ key ^ given[4]) | (f ^ key ^ given[5]) | (g ^ key ^ given[6]) | (h ^ key ^ given[7]);
}

let open;
const gate = new Promise(resolve => (open = resolve));
const results = [];
for (const [upper, lower] of halvesOfDroppedObjects(32)) {
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      if (i === j) continue;
      const integers = [1, 2, 3, 4, 5, 6, 7, 8];
      integers[i] = upper;
      integers[j] = lower;
      const key = results.length % 1000;
      results.push(keeps(gate, integers.map(integer => integer ^ key), key));
    }
  }
}
Bun.gc(true);
open();
let changed = 0;
for (const result of results) if ((await result) !== 0) changed++;
console.log(results.length + " functions waited, " + changed + " got other integers back");
