// A loop that counts down, tested at its bottom, whose first index may be -1. Two tests for equality leave the tested counter never negative, so the test is unsigned.
const list = [];
for (let i = 0; i < 32; i++) list.push(i * 3 + 1);
function walk(list, seed, limit) {
  const end = limit >>> 1;
  let hash = 0, i = (seed & 63) - 1;
  do {
    hash = (hash * 31 + (list[i] | 0)) | 0;
    if (i === -1) break;
    if (i === 0) break;
    i--;
  } while (i > end);
  return hash + i;
}
let total = 7;
for (let seed = 0; seed < 40; seed++) for (let limit = 0; limit < 40; limit++) total = (total + walk(list, seed, limit)) | 0;
console.log(total);
