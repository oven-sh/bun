// The same cut texts are asked for again and again: in other tables, behind collections, once they were compared, joined, made keys or names.
const bases = ["alpha beta gamma delta ".repeat(8), "älpha βeta gämma δelta ".repeat(8), "\u{1F600}x\u{1F680}yz日本 ".repeat(8)];
const words = new Set(["alpha", "beta", "gamma", "älpha", "βeta", "x", "日本", "pha", "", "a"]);
const counts = new Map([["alpha", 1], ["γ", 2], ["eta", 3], ["yz日本", 4]]);
const marks = {};
let held = [];
for (const base of bases) {
  for (let from = 0; from < 14; from++) for (const length of [0, 1, 2, 3, 5, 9, 30, 47, 48, 49]) held.push(base.slice(from, from + length), base.substring(from + 3, from + length));
}
function ask(turn) {
  let log = "";
  for (const key of held) {
    log += words.has(key) ? "w" : "-";
    if (counts.has(key)) log += counts.get(key);
    if (turn === 2 && key.length === 3) words.add(key);
    if (turn === 3 && key.length === 5) counts.set(key, turn + key.length);
    if (turn === 4) marks[key] = (marks[key] ?? 0) + 1;
    if (turn === 5 && key === "alpha") log += "=";
    if (turn === 6) log += (key + "!").length;
    if (turn === 7 && words.delete(key)) log += "d";
  }
  return log;
}
for (let turn = 0; turn < 9; turn++) {
  const log = ask(turn);
  let sum = 0;
  for (let i = 0; i < log.length; i++) sum = (sum * 31 + log.charCodeAt(i)) | 0;
  console.log(turn, log.slice(0, 120), sum, words.size, counts.size);
  if (turn === 1 || turn === 6) Bun.gc(true);
  if (turn === 4) held = held.map((key, i) => (i & 1 ? key : key.slice(1)));
}
console.log(Object.keys(marks).length, Object.values(marks).reduce((a, b) => a + b, 0), [...words].length, [...counts].join("|").slice(0, 300));
