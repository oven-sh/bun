// One element is added to on every turn. Every fourth turn the same element is written under another name: of the same array, or of bytes that lie over it.
function addUp(sums, others, place, turns) {
  for (let turn = 0; turn < turns; turn++) {
    sums[place] = sums[place] + turn;
    others[turn & 3] = 7;
  }
  return sums[place];
}

function addUpBesideBytes(sums, bytes, place, turns) {
  for (let turn = 0; turn < turns; turn++) {
    sums[place] = sums[place] + turn;
    bytes[(turn & 3) * 4 + 1] = 1;
  }
  return sums[place];
}

function addUpNumbers(sums, others, place, turns) {
  for (let turn = 0; turn < turns; turn++) {
    sums[place] += turn * 0.5;
    others[turn & 3] = -1;
  }
  return sums[place];
}

const one = new Int32Array(8);
console.log(addUp(one, one, 2, 1000), addUp(new Int32Array(8), new Int32Array(8), 2, 1000));
const words = new Int32Array(8);
console.log(
  addUpBesideBytes(words, new Uint8Array(words.buffer), 2, 1000),
  addUpBesideBytes(new Int32Array(8), new Uint8Array(32), 2, 1000),
);
const numbers = new Float64Array(8);
console.log(addUpNumbers(numbers, numbers, 2, 1000), addUpNumbers(new Float64Array(8), new Float64Array(8), 2, 1000));
const behind = new Int32Array(words.buffer, 8);
console.log(addUp(words, behind, 2, 1000), addUp(behind, words, 0, 1000));
