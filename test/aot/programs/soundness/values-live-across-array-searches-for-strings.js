// Values of every kind stay live across Array.prototype.includes and indexOf while the search compares strings, reads through getters and converts its start index.
const known = ["a whole text with a tail", "tail", "alpha", "beta"];
const asked = ["a whole text with a tai", "whole text", "beta", "alph" + "a", "", "tail"];

let total = 0;
for (let i = 0; i < asked.length; i++) {
  const weight = asked[i].length * 3;
  if (known.includes(asked[i])) total += 1000;
  total += weight;
}
console.log(total);

for (const text of asked)
  console.log(known.includes(text), text);

for (const text of asked)
  console.log(known[0].endsWith(text), known.includes(text), known.indexOf(text), text.length);

function search(list, texts) {
  let found = 0;
  let lengths = 0;
  let last = "none";
  let half = 0.5;
  const seen = [];
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    const isLong = text.length > 4;
    const at = list.indexOf(text);
    const has = list.includes(text, 1);
    if (at >= 0) found++;
    if (has) last = text;
    if (isLong) lengths += text.length;
    half += at / 2;
    seen.push(i, at, has, isLong);
  }
  return [found, lengths, last, half, seen.join()].join(" ");
}
console.log(search(known, asked));
console.log(search(asked, known));

const listLike = {
  get length() {
    return 3;
  },
  get 0() {
    return "x" + "y";
  },
  1: "tail",
  2: "beta",
};
for (const text of asked) {
  const before = text + "!";
  const has = Array.prototype.includes.call(listLike, text);
  const at = Array.prototype.indexOf.call(listLike, text, { valueOf: () => 0 });
  console.log(before, has, at, text);
}
