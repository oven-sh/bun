// Two lists of pairs are mapped in one program, one of numbers and one of a text and a number. Both go through the one function of the library that maps, so what a pair may hold is a number or a
// text for both, and the function that is given for the numbers asks first what kind of value the second member is and compares behind that. To know the way of the comparison the build has to
// know the way of the test in front of it: a test is answered while another is being answered.
// COUNTER: RegExpsCreatedWithoutRecord = 0
// COUNTER: RegExpsCompiledToBytecode = 0
// COUNTER: RegExpMatchesInterpreted = 0
const A = 0x41, B = 0x5a, C = 0x5f, D = 0x5f, E = 0x100, F = 0x17f;
const ranges = Object.freeze([[A, B], [C, D], [E, F]]);
const inner = ranges.map(([low, high]) => `\\u{${low.toString(16)}}` + (high > low ? `-\\u{${high.toString(16)}}` : "")).join("");
const words = [["ab", 2], ["cde", 3], ["f", 4]];
const counted = words.map(([text, count]) => (text.length === count ? text : text.length < count ? `${text}{${count}}` : `(?:${text})`)).join("|");
const made = [new RegExp(`^[${inner}]+$`, "u"), new RegExp(`[^${inner}]`, "gu"), new RegExp(`^(?:${counted})$`)];
console.log(made.map(each => each.source + "/" + each.flags).join(" "));
const subjects = ["AZ_", "a", "\u0100Z", "ab", "cde", "ffff", "f"];
let answers = "";
for (const each of made) {
  for (const subject of subjects) {
    each.lastIndex = 0;
    answers += each.test(subject) ? 1 : 0;
  }
  answers += " ";
}
console.log(answers);
