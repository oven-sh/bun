// STATISTIC: UnrolledLoopsWithSharedReentry >= 1
// The turns of a counted loop that reads the code units of a text are laid out in a row once for narrow texts and once for wide ones: the width is asked in front, not at every unit.
// Here: a loop that leaves its turns at a line's end and comes back, one that never leaves, one over two texts of either width, one downward; texts of both widths, wide texts that hold
// narrow units alone, every length round the eight turns of a row, and units that only a wide text can hold.
const key: "go" = JSON.parse('"go"');
const starts = { go(text: string): string { const found: number[] = []; let pos = 0, start = 0; while (pos < text.length) { const ch = text.charCodeAt(pos); pos++; switch (ch) { case 13: if (text.charCodeAt(pos) === 10) pos++; case 10: found.push(start); start = pos; break; default: if (ch > 127 && (ch === 0x2028 || ch === 0x2029)) { found.push(start); start = pos; } } } found.push(start); return found.length + ":" + found.slice(-3).join(","); } };
const hash = { go(text: string): number { let t = 7; for (let i = 0; i < text.length; i++) t = (t * 31 + text.charCodeAt(i)) | 0; return t; } };
const pair = { go(a: string, b: string): number { let t = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) t = (t + a.charCodeAt(i) * 3 + b.charCodeAt(i)) | 0; return t; } };
const down = { go(text: string): number { let t = 0, odd = 7; for (let i = text.length - 1; i >= 0; i--) { const v = text.charCodeAt(i); if (v === 10) { odd = (odd * 31 + i) | 0; continue; } t = (t + v) | 0; } return (t ^ odd) | 0; } };
const fresh = (text: string): string => JSON.parse(JSON.stringify(text));
const wideOf = (text: string): string => ("Ж" + text).slice(1);
const lines = (lengths: number[], unit: string, end: string): string => lengths.map(n => unit.repeat(n) + end).join("");
const repeat = (lengths: number[], times: number): number[] => Array(times).fill(lengths).flat();
const narrow: string[] = ["", "\n", "x", "x\n", "\r\n", "x\r", lines(repeat([0], 70), "x", "\n"), lines(repeat([1], 60), "x", "\n"), lines(repeat([11, 12, 13], 30), "x", "\r\n"), lines(repeat([60, 55, 1, 0], 12), "y", "\n"), "x".repeat(2000), "x".repeat(700) + "\n\n\n", lines([...repeat([2], 300), ...repeat([60], 20)], "z", "\n")];
for (let length = 0; length < 40; length++) narrow.push("abcdefghij".repeat(4).slice(0, length), (lines(repeat([5], 8), "q", "\n")).slice(0, length));
const texts: string[] = [];
for (const text of narrow) texts.push(fresh(text), wideOf(text), fresh(text.replace(/x/g, "Ж")), fresh(text.replace(/\n/g, " ")), fresh(text + "￿"), fresh("😀" + text));
let all = 0;
for (let index = 0; index < texts.length; index++) {
    const text = texts[index], other = texts[(index * 7 + 3) % texts.length];
    const line = [text.length, starts[key](text), hash[key](text), pair[key](text, other), pair[key](other, text), down[key](text)].join(" ");
    all = (all * 33 + hash[key](line)) | 0;
    if (index % 9 === 0) console.log(line);
}
console.log(texts.length, all);
