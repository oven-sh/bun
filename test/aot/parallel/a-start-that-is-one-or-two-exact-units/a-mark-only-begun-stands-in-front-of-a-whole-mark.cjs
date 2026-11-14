"use strict";
const more = process.argv.length > 99 ? 1 : 0;
const parts = JSON.parse('["\\u001b", "\\u001b[31m", "plain words, [0123]; m m ", "\\u2502"]');
const [begun, whole, filler, wideLetter] = parts;
function byHand(text) { for (let i = 0; i < text.length; i++) { if (text[i] !== begun || text[i + 1] !== "[") continue; let j = i + 2; while (j < text.length && ((text[j] >= "0" && text[j] <= "9") || text[j] === ";")) j++; if (text[j] === "m") return i; } return -1; }
let cells = 0, wrong = 0, sum = 0;
for (const front of ["", wideLetter]) {
  for (let first = 0; first <= 40 + more; first++) {
    for (let between = 0; between <= 40; between++) {
      for (const falseStarts of [1, 2, 3]) {
        for (const tail of [0, 7, 30]) {
          const letters = filler.repeat(3);
          const text = (front + letters.slice(0, first) + (begun + letters.slice(0, between)).repeat(falseStarts) + whole + letters.slice(0, tail)).slice(0);
          const expected = byHand(text), found = text.search(/\u001b\[[0-9;]*m/);
          cells++; if (found !== expected) wrong++;
          const removed = text.replace(/\u001b\[[0-9;]*m/g, "");
          cells++; if (removed.length !== text.length - whole.length) wrong++;
          sum = (sum * 31 + found + removed.length) % 1000003;
        }
      }
    }
  }
}
console.log("cells " + cells + " wrong " + wrong + " sum " + sum);
