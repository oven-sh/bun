"use strict";
const more = process.argv.length > 99 ? 1 : 0;
const filler = JSON.parse('"plain \\u2503 words \\u2501\\u0102 0123 \\u0002\\u0025"');
const marks = JSON.parse('["\\u2502", "\\u2500"]');
const pattern = /[\u2502\u2500]\[*[a-z]/, every = /[\u2502\u2500]\[*[a-z]/g;
function endByHand(text, i) { let j = i + 1; while (text[j] === "[") j++; return j < text.length && text[j] >= "a" && text[j] <= "z" ? j + 1 : -1; }
function byHand(text, from) { for (let i = from; i < text.length; i++) if (marks.includes(text[i]) && endByHand(text, i) > 0) return i; return -1; }
let cells = 0, wrong = 0, sum = 0;
for (let length = 0; length <= 70 + more; length++) {
  const plain = filler.repeat(8).slice(0, length);
  for (let at = 0; at <= length; at++) {
    for (const mark of marks) {
      for (const tail of ["[", "", "x"]) {
        const text = (plain.slice(0, at) + mark + tail + plain.slice(at)).slice(0);
        const expected = byHand(text, 0), found = text.search(pattern);
        cells++; if (found !== expected) wrong++;
        const removed = text.replace(every, "");
        cells++; if (removed.length !== text.length - (expected < 0 ? 0 : endByHand(text, expected) - expected)) wrong++;
        sum = (sum * 31 + found + removed.length) % 1000003;
      }
    }
  }
}
console.log("cells " + cells + " wrong " + wrong + " sum " + sum);
