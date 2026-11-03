// A global match whose list is read only for its length, its presence or its first elements. The pattern's lastIndex and the
// properties of RegExp that remember the last match must end up as if the list had been made.
function lengthOf(s, re) {
  return s.match(re)?.length ?? -1;
}
function firstTwo(s, re) {
  const m = s.match(re);
  if (!m) return "none";
  return m[0] + "|" + m[1] + "|" + m.length;
}
function first(s, re) {
  const m = s.match(re);
  return m ? m[0] : "none";
}
function second(s, re) {
  const m = s.match(re);
  return m && m.length > 1 ? m[1] + m[0] : "short";
}
function isThere(s, re) {
  return s.match(re) !== null;
}
const subjects = [
  "The quick brown fox",
  "rhythm",
  "aeiou AEIOU",
  "",
  "aaa",
  "\u{1F600}\u{1F600}x",
  "a\nb\nc",
  "xyxyxy",
];
const patterns = () => [
  /[aeiou]/gi,
  /x*/g,
  /x*/gu,
  /./gu,
  /./g,
  /^./gm,
  /a/gy,
  /(?:)/g,
  /(?:)/gu,
  /xy/g,
  /(x)(y)?/g,
  /\b/g,
  /$/g,
  /[^]/g,
];
const out = [];
for (let round = 0; round < 300; round++) {
  for (const s of subjects) {
    for (const re of patterns()) {
      re.lastIndex = round % 5;
      const a = lengthOf(s, re);
      const afterLength = re.lastIndex + ":" + RegExp.lastMatch + ":" + RegExp["$1"] + ":" + RegExp.leftContext.length;
      re.lastIndex = 2;
      const b = firstTwo(s, re);
      const c = isThere(s, re) + " " + JSON.stringify(first(s, re)) + " " + JSON.stringify(second(s, re));
      if (round === 299)
        out.push([re.source + "/" + re.flags, JSON.stringify(s), a, afterLength, b, c, re.lastIndex].join(" "));
    }
  }
}
console.log(out.join("\n"));
const frozen = Object.freeze(/a/g);
for (const f of [lengthOf, firstTwo, isThere, first, second]) {
  try {
    console.log(f("banana", frozen));
  } catch (e) {
    console.log(e.name + ": " + e.message);
  }
}
const rope = "ab".repeat(40) + "cd".repeat(3);
console.log(lengthOf(rope + rope, /b/g), firstTwo(rope.slice(3, 60), /a./g), lengthOf(rope.substring(1), /ab|cd/g));
function firstOfLiteral(s) {
  const m = s.match(/[aeiou]./gi);
  return m ? m[0] + m.length : "none";
}
function twoOfLiteral(s) {
  const m = s.match(/x*y?/g);
  return m && m.length > 1 ? JSON.stringify(m[0]) + JSON.stringify(m[1]) + m.length : "short";
}
function threeOfUnicodeLiteral(s) {
  const m = s.match(/./gu);
  if (!m || m.length < 3) return "short";
  return m[2] + m[1] + m[0];
}
let text = "";
for (let round = 0; round < 3000; round++) {
  const s = subjects[round % subjects.length];
  const line =
    firstOfLiteral(s) + " " + twoOfLiteral(s) + " " + threeOfUnicodeLiteral(s) + " " + RegExp.lastMatch.length;
  if (round >= 3000 - subjects.length) text += line + "\n";
}
console.log(text);
