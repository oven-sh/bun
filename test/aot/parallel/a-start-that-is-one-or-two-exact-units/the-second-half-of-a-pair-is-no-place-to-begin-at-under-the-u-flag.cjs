"use strict";
const more = process.argv.length > 99 ? 1 : 0;
const parts = JSON.parse('["\\ud83d\\ude00", "\\ude00", "\\ud83d", "\\ude01", "~", "c"]');
const filler = JSON.parse('"plain words \\u2502 0123"');
function byHand(text, isStart) { for (let i = 0; i < text.length; ) { const point = text.codePointAt(i); if (isStart(point, text, i)) return i; i += point > 0xffff ? 2 : 1; } return -1; }
let cells = 0, wrong = 0, sum = 0;
for (let length = 0; length <= 44 + more; length++) {
  const plain = filler.repeat(4).slice(0, length);
  for (let at = 0; at <= length; at++) {
    for (const first of parts) for (const second of parts) {
      const text = (plain.slice(0, at) + first + second + plain.slice(at)).slice(0);
      const asked = [
        [text.search(/\ude00/u), byHand(text, p => p === 0xde00)],
        [text.search(/[\ude00\ude01]c/u), byHand(text, (p, t, i) => (p === 0xde00 || p === 0xde01) && t[i + 1] === "c")],
        [text.search(/[~\ude00]/u), byHand(text, p => p === 0xde00 || p === 0x7e)],
        [text.search(/\ud83d/u), byHand(text, p => p === 0xd83d)],
        [text.search(/\ude00/v), byHand(text, p => p === 0xde00)],
        [text.search(/\ude00/), text.indexOf("\ude00")],
      ];
      for (const [found, expected] of asked) { cells++; if (found !== expected) wrong++; sum = (sum * 31 + found + 1) % 1000003; }
      sum = (sum * 31 + text.replace(/\ude00/gu, "").length + [...text.matchAll(/[~\ude00]/gu)].length) % 1000003;
    }
  }
}
console.log("cells " + cells + " wrong " + wrong + " sum " + sum);
