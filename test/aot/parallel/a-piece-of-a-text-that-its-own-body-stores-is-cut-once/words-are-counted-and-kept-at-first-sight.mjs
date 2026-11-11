// Hits are the rule: the count is stored at the place that the lookup found. The piece is kept in an object at its first sight alone.
const text = String(JSON.parse('"' + Array.from({ length: 60 }, (_, i) => "w" + String.fromCharCode(97 + ((i * 7) % 23)) + "x").join("") + '"'));
const counts = new Map();
const firsts = [];
function count(turn) {
  for (let from = 0; from + 3 <= text.length; from += 3) {
    const word = text.slice(from, from + 3);
    const n = counts.get(word);
    if (n === undefined) {
      counts.set(word, 1);
      firsts.push({ word, turn });
    } else counts.set(word, n + 1);
  }
  if (turn === 3) counts.delete("wax");
  return counts.size + firsts.length;
}
let sum = 0;
for (let turn = 0; turn < 50; turn++) sum = (Math.imul(sum, 31) + count(turn)) | 0;
console.log(sum >>> 0, counts.get("wdx"), counts.get("wax"), firsts.length, firsts.map(one => one.word + one.turn).join(), [...counts.keys()].join());
