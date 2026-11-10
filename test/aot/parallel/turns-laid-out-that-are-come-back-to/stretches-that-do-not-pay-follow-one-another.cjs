"use strict";
// STATISTIC: LoopsLaidOutThatAreComeBackTo >= 1
// Where coming back to the turns laid out was not paid by the stretch that followed, the loop as written runs for as long as what is owed says, and what is owed grows with every stretch that does not pay. The marks stand close, far apart, close and then far apart, right at the end and nowhere; the written loop never runs past the bound and always takes at least one turn.
const key = JSON.parse('"go"');
const up = { go(text) { const starts = []; let pos = 0, start = 0; while (pos < text.length) { const ch = text.charCodeAt(pos); pos++; switch (ch) { case 13: if (text.charCodeAt(pos) === 10) pos++; case 10: starts.push(start); start = pos; break; default: if (ch > 127) { starts.push(-start); start = pos; } break; } } starts.push(start); let h = starts.length; for (const s of starts) h = (h * 31 + s) | 0; return h; } };
const down = { go(bytes) { let t = 0, odd = 7; for (let i = bytes.length - 1; i >= 0; i--) { const v = bytes[i]; if (v === 10) { odd = (odd * 31 + i) | 0; continue; } t = (t + v) | 0; } return t + ":" + odd; } };
const byThrees = { go(bytes) { let t = 0, odd = 7; for (let i = 0; i < bytes.length; i += 3) { const v = bytes[i]; if (v === 10) { odd = (odd * 31 + i) | 0; continue; } t = (t + v) | 0; } return t + ":" + odd; } };
const lines = lengths => lengths.map(n => "x".repeat(n) + "\n").join("");
const repeat = (lengths, times) => Array(times).fill(lengths).flat();
const texts = [
    "", "\n", "x", "x\n", lines(repeat([0], 700)), lines(repeat([1], 400)), lines(repeat([5], 200)), lines(repeat([11], 90)), lines(repeat([12], 90)), lines(repeat([13], 90)),
    lines(repeat([60, 55, 1, 0], 12)), lines(repeat([42, 55, 38, 5, 0, 61, 47, 33, 9, 3, 1, 0], 5)), lines([...repeat([2], 300), ...repeat([60], 20)]), lines([...repeat([60], 20), ...repeat([2], 300)]),
    lines([...repeat([3], 40), 900, ...repeat([3], 40), 900]), "x".repeat(2000), "x".repeat(700) + "\n\n\n", "\n\n\n" + "x".repeat(700), lines(repeat([7, 0, 0, 0, 30], 30)) + "x".repeat(5), lines(repeat([4], 30)) + "\r\n\r\n" + "x".repeat(40) + " " + lines(repeat([1, 90], 6)),
];
for (let cut = 0; cut < 40; cut++) texts.push(lines(repeat([2], 60)).slice(0, 140 + cut), (lines(repeat([50], 4)) + lines(repeat([1], 30))).slice(0, 230 + cut));
for (const text of texts) { const bytes = Uint8Array.from(text, c => c.charCodeAt(0) & 255); console.log(text.length, up[key](JSON.parse(JSON.stringify(text))), down[key](bytes), byThrees[key](bytes)); }
