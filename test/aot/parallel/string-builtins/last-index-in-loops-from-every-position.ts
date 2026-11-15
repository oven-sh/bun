// lastIndexOf with a position, in loops over texts that stand in front of them: a character that stands only behind the position is not found.
function flat(text: string) { return JSON.parse(JSON.stringify(text)) as string; }
function one(s: string, from: number) { return s.lastIndexOf("é", from); }
function naive(s: string, from: number) { for (let i = Math.min(from, s.length - 1); i >= 0; i--) if (s.charCodeAt(i) === 0xe9) return i; return -1; }
let wrong = 0;
for (let length = 1; length < 80; length++) for (let at = 0; at < length; at++) { const s = flat("x".repeat(at) + "é" + "x".repeat(length - at - 1)); const bad: string[] = []; for (let from = 0; from < length + 2; from++) { const got = one(s, from); if (got !== naive(s, from)) bad.push(from + ">" + got); } if (bad.length && wrong++ < 5) console.log(length, at, bad.join(" ")); }
console.log(wrong);
