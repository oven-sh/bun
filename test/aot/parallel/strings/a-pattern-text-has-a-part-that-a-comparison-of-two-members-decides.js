// A class of characters is put together from a list of pairs of numbers: the first as it is, and the second behind a dash only where it is greater. Between the comparison and the place where
// its two arms meet stands more than a jump: the call that prints the number has a rare way round it, and the reads of the pair's members stand twice, once for a place within the pair and once
// for one behind its end. The build knows which blocks nothing comes to, so it knows the arm that is taken for each pair and with it the whole text.
// COUNTER: RegExpsCreatedWithoutRecord = 0
// COUNTER: RegExpsCompiledToBytecode = 0
// COUNTER: RegExpMatchesInterpreted = 0
const A = 0x41, B = 0x5a, C = 0x5f, D = 0x5f, E = 0x100, F = 0x17f;
const ranges = Object.freeze([[A, B], [C, D], [E, F]]);
const inner = ranges.map(([low, high]) => `\\u{${low.toString(16)}}` + (high > low ? `-\\u{${high.toString(16)}}` : "")).join("");
const made = [new RegExp(`^[${inner}]+$`, "u"), new RegExp(`[^${inner}]`, "gu")];
console.log(made.map(each => each.source + "/" + each.flags).join(" "));
const subjects = ["AZ_", "a", "\u0100Z", "ab", "_"];
let answers = "";
for (const each of made) {
  for (const subject of subjects) {
    each.lastIndex = 0;
    answers += each.test(subject) ? 1 : 0;
  }
  answers += " ";
}
console.log(answers);
