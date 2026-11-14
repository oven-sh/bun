'use strict';
const given = JSON.parse('["\\ud83d\\ude00a\\ud83d\\ude00","ab","\\u00e9x\\u00e9","\\ud83dq\\ud83d"]');
for (const tail of ['-', '--------------------']) for (let at = 0; at < 4; at++) given.push(given[at] + tail + given[at]);
function mirrored() {
  let said = '';
  for (const word of given) {
    let i = 0, j = word.length - 1;
    while (i < j && word[i] === word[j]) { i++; j--; }
    said += i + ':' + j + ' ';
  }
  return said;
}
globalThis.kept = mirrored;
for (let turn = 0; turn < 2; turn++) console.log(mirrored());
