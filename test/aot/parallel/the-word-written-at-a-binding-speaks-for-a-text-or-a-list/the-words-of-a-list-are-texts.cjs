'use strict';
const words = JSON.parse('["level","Beta","gamma ray","noon","","x","abccba","abcdba"]');
function mirrored(from) {
  let count = from & 1;
  for (const word of words) {
    let i = 0, j = word.length - 1;
    while (i < j && word[i] === word[j]) { i++; j--; }
    if (i >= j) count++;
  }
  return count;
}
globalThis.kept = mirrored;
for (let turn = 0; turn < 4; turn++) console.log(mirrored(turn));
