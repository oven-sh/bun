// In unicode mode no match begins between the two halves of a surrogate pair. A pattern whose text the build does not know is run by a program that goes by code units and makes an attempt there
// too; a pattern that can match nothing, as `\B` or `(?<!a)(?!a)`, found a match there: `new RegExp("\\B" + nothing, "u").exec("a\u{1F600}b")` answered 2:"" for null. Whoever runs such a program
// has to search on behind such a match, as RegExp::matchInlineAtCodePointBoundaries() does; the road from compiled code straight to the program, for a 16-bit subject, did not.
// What it takes to come that way: no literal of the same text in the program (the run would find its code); an expression of which the build knows at the call that it is a RegExp as it was made
// (its own constant, handed to nothing else); a function of ordinary size; several subjects, for the first asking goes the long way round. Neither g nor y.
const nothing = String(Date.now()).slice(99);
const subjects = ["a\u{1F600}b", "a\u{1F600}\ude00", "\u{1F600}", "\u{1F600}\u{1F600}", "\u{1F600}ab", "ab", "\ud83d", "\ude00a", "\u{1F600}\n\u{1F600}", "x\u{1F600}x\u{1F600}", "c\u{1E922}aaaa", "", "a\u{1F600}", "aa\u{1F600}\u{1F600}bb"];
const show = m => (m ? m.index + ":" + JSON.stringify(m[0]) + (m.length > 1 ? "," + JSON.stringify(m[1]) : "") : "null");
function ask1() {
  const forExec = new RegExp("\\B" + nothing, "u"), forTest = new RegExp("\\B" + nothing, "u"), forMatch = new RegExp("\\B" + nothing, "u");
  let line = "/\\B/u ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask2() {
  const forExec = new RegExp("\\B" + nothing, "v"), forTest = new RegExp("\\B" + nothing, "v"), forMatch = new RegExp("\\B" + nothing, "v");
  let line = "/\\B/v ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask3() {
  const forExec = new RegExp("(?<!a)(?!a)" + nothing, "u"), forTest = new RegExp("(?<!a)(?!a)" + nothing, "u"), forMatch = new RegExp("(?<!a)(?!a)" + nothing, "u");
  let line = "/(?<!a)(?!a)/u ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask4() {
  const forExec = new RegExp("(?<!a)(?!a)" + nothing, "v"), forTest = new RegExp("(?<!a)(?!a)" + nothing, "v"), forMatch = new RegExp("(?<!a)(?!a)" + nothing, "v");
  let line = "/(?<!a)(?!a)/v ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask5() {
  const forExec = new RegExp("\\B|x" + nothing, "u"), forTest = new RegExp("\\B|x" + nothing, "u"), forMatch = new RegExp("\\B|x" + nothing, "u");
  let line = "/\\B|x/u ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask6() {
  const forExec = new RegExp("\\B|x" + nothing, "v"), forTest = new RegExp("\\B|x" + nothing, "v"), forMatch = new RegExp("\\B|x" + nothing, "v");
  let line = "/\\B|x/v ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask7() {
  const forExec = new RegExp("(?:)\\B" + nothing, "u"), forTest = new RegExp("(?:)\\B" + nothing, "u"), forMatch = new RegExp("(?:)\\B" + nothing, "u");
  let line = "/(?:)\\B/u ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask8() {
  const forExec = new RegExp("(?:)\\B" + nothing, "v"), forTest = new RegExp("(?:)\\B" + nothing, "v"), forMatch = new RegExp("(?:)\\B" + nothing, "v");
  let line = "/(?:)\\B/v ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask9() {
  const forExec = new RegExp("(\\B)" + nothing, "u"), forTest = new RegExp("(\\B)" + nothing, "u"), forMatch = new RegExp("(\\B)" + nothing, "u");
  let line = "/(\\B)/u ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask10() {
  const forExec = new RegExp("(\\B)" + nothing, "v"), forTest = new RegExp("(\\B)" + nothing, "v"), forMatch = new RegExp("(\\B)" + nothing, "v");
  let line = "/(\\B)/v ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask11() {
  const forExec = new RegExp("\\B\\B" + nothing, "u"), forTest = new RegExp("\\B\\B" + nothing, "u"), forMatch = new RegExp("\\B\\B" + nothing, "u");
  let line = "/\\B\\B/u ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask12() {
  const forExec = new RegExp("\\B\\B" + nothing, "v"), forTest = new RegExp("\\B\\B" + nothing, "v"), forMatch = new RegExp("\\B\\B" + nothing, "v");
  let line = "/\\B\\B/v ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask13() {
  const forExec = new RegExp("(?=\\B)" + nothing, "u"), forTest = new RegExp("(?=\\B)" + nothing, "u"), forMatch = new RegExp("(?=\\B)" + nothing, "u");
  let line = "/(?=\\B)/u ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask14() {
  const forExec = new RegExp("(?=\\B)" + nothing, "v"), forTest = new RegExp("(?=\\B)" + nothing, "v"), forMatch = new RegExp("(?=\\B)" + nothing, "v");
  let line = "/(?=\\B)/v ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask15() {
  const forExec = new RegExp("(?<=\\B)" + nothing, "u"), forTest = new RegExp("(?<=\\B)" + nothing, "u"), forMatch = new RegExp("(?<=\\B)" + nothing, "u");
  let line = "/(?<=\\B)/u ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask16() {
  const forExec = new RegExp("(?<=\\B)" + nothing, "v"), forTest = new RegExp("(?<=\\B)" + nothing, "v"), forMatch = new RegExp("(?<=\\B)" + nothing, "v");
  let line = "/(?<=\\B)/v ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask17() {
  const forExec = new RegExp("$|\\B" + nothing, "u"), forTest = new RegExp("$|\\B" + nothing, "u"), forMatch = new RegExp("$|\\B" + nothing, "u");
  let line = "/$|\\B/u ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask18() {
  const forExec = new RegExp("$|\\B" + nothing, "v"), forTest = new RegExp("$|\\B" + nothing, "v"), forMatch = new RegExp("$|\\B" + nothing, "v");
  let line = "/$|\\B/v ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask19() {
  const forExec = new RegExp("[ab_]$|\\B" + nothing, "u"), forTest = new RegExp("[ab_]$|\\B" + nothing, "u"), forMatch = new RegExp("[ab_]$|\\B" + nothing, "u");
  let line = "/[ab_]$|\\B/u ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask20() {
  const forExec = new RegExp("[ab_]$|\\B" + nothing, "v"), forTest = new RegExp("[ab_]$|\\B" + nothing, "v"), forMatch = new RegExp("[ab_]$|\\B" + nothing, "v");
  let line = "/[ab_]$|\\B/v ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask21() {
  const forExec = new RegExp("(?<![a-z])(?![a-z])" + nothing, "u"), forTest = new RegExp("(?<![a-z])(?![a-z])" + nothing, "u"), forMatch = new RegExp("(?<![a-z])(?![a-z])" + nothing, "u");
  let line = "/(?<![a-z])(?![a-z])/u ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask22() {
  const forExec = new RegExp("(?<![a-z])(?![a-z])" + nothing, "v"), forTest = new RegExp("(?<![a-z])(?![a-z])" + nothing, "v"), forMatch = new RegExp("(?<![a-z])(?![a-z])" + nothing, "v");
  let line = "/(?<![a-z])(?![a-z])/v ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask23() {
  const forExec = new RegExp("(?<!^)" + nothing, "u"), forTest = new RegExp("(?<!^)" + nothing, "u"), forMatch = new RegExp("(?<!^)" + nothing, "u");
  let line = "/(?<!^)/u ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask24() {
  const forExec = new RegExp("(?<!^)" + nothing, "v"), forTest = new RegExp("(?<!^)" + nothing, "v"), forMatch = new RegExp("(?<!^)" + nothing, "v");
  let line = "/(?<!^)/v ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask25() {
  const forExec = new RegExp("(?<!^)(?!$)" + nothing, "u"), forTest = new RegExp("(?<!^)(?!$)" + nothing, "u"), forMatch = new RegExp("(?<!^)(?!$)" + nothing, "u");
  let line = "/(?<!^)(?!$)/u ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask26() {
  const forExec = new RegExp("(?<!^)(?!$)" + nothing, "v"), forTest = new RegExp("(?<!^)(?!$)" + nothing, "v"), forMatch = new RegExp("(?<!^)(?!$)" + nothing, "v");
  let line = "/(?<!^)(?!$)/v ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask27() {
  const forExec = new RegExp("(?:a|\\B)" + nothing, "u"), forTest = new RegExp("(?:a|\\B)" + nothing, "u"), forMatch = new RegExp("(?:a|\\B)" + nothing, "u");
  let line = "/(?:a|\\B)/u ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask28() {
  const forExec = new RegExp("(?:a|\\B)" + nothing, "v"), forTest = new RegExp("(?:a|\\B)" + nothing, "v"), forMatch = new RegExp("(?:a|\\B)" + nothing, "v");
  let line = "/(?:a|\\B)/v ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask29() {
  const forExec = new RegExp("(?<x>\\B)" + nothing, "u"), forTest = new RegExp("(?<x>\\B)" + nothing, "u"), forMatch = new RegExp("(?<x>\\B)" + nothing, "u");
  let line = "/(?<x>\\B)/u ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask30() {
  const forExec = new RegExp("(?<x>\\B)" + nothing, "v"), forTest = new RegExp("(?<x>\\B)" + nothing, "v"), forMatch = new RegExp("(?<x>\\B)" + nothing, "v");
  let line = "/(?<x>\\B)/v ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask31() {
  const forExec = new RegExp("(?<![ab])\\B" + nothing, "u"), forTest = new RegExp("(?<![ab])\\B" + nothing, "u"), forMatch = new RegExp("(?<![ab])\\B" + nothing, "u");
  let line = "/(?<![ab])\\B/u ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask32() {
  const forExec = new RegExp("(?<![ab])\\B" + nothing, "v"), forTest = new RegExp("(?<![ab])\\B" + nothing, "v"), forMatch = new RegExp("(?<![ab])\\B" + nothing, "v");
  let line = "/(?<![ab])\\B/v ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask33() {
  const forExec = new RegExp("[^\\s\\S]|\\B" + nothing, "u"), forTest = new RegExp("[^\\s\\S]|\\B" + nothing, "u"), forMatch = new RegExp("[^\\s\\S]|\\B" + nothing, "u");
  let line = "/[^\\s\\S]|\\B/u ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask34() {
  const forExec = new RegExp("[^\\s\\S]|\\B" + nothing, "v"), forTest = new RegExp("[^\\s\\S]|\\B" + nothing, "v"), forMatch = new RegExp("[^\\s\\S]|\\B" + nothing, "v");
  let line = "/[^\\s\\S]|\\B/v ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask35() {
  const forExec = new RegExp("(?!.)" + nothing, "u"), forTest = new RegExp("(?!.)" + nothing, "u"), forMatch = new RegExp("(?!.)" + nothing, "u");
  let line = "/(?!.)/u ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask36() {
  const forExec = new RegExp("(?!.)" + nothing, "v"), forTest = new RegExp("(?!.)" + nothing, "v"), forMatch = new RegExp("(?!.)" + nothing, "v");
  let line = "/(?!.)/v ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask37() {
  const forExec = new RegExp("(?<=.)\\B" + nothing, "u"), forTest = new RegExp("(?<=.)\\B" + nothing, "u"), forMatch = new RegExp("(?<=.)\\B" + nothing, "u");
  let line = "/(?<=.)\\B/u ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask38() {
  const forExec = new RegExp("(?<=.)\\B" + nothing, "v"), forTest = new RegExp("(?<=.)\\B" + nothing, "v"), forMatch = new RegExp("(?<=.)\\B" + nothing, "v");
  let line = "/(?<=.)\\B/v ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask39() {
  const forExec = new RegExp("(?!\\p{L})(?<!\\p{L})" + nothing, "u"), forTest = new RegExp("(?!\\p{L})(?<!\\p{L})" + nothing, "u"), forMatch = new RegExp("(?!\\p{L})(?<!\\p{L})" + nothing, "u");
  let line = "/(?!\\p{L})(?<!\\p{L})/u ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask40() {
  const forExec = new RegExp("(?!\\p{L})(?<!\\p{L})" + nothing, "v"), forTest = new RegExp("(?!\\p{L})(?<!\\p{L})" + nothing, "v"), forMatch = new RegExp("(?!\\p{L})(?<!\\p{L})" + nothing, "v");
  let line = "/(?!\\p{L})(?<!\\p{L})/v ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask41() {
  const forExec = new RegExp("(?!\\u{1F600})(?<!a)" + nothing, "u"), forTest = new RegExp("(?!\\u{1F600})(?<!a)" + nothing, "u"), forMatch = new RegExp("(?!\\u{1F600})(?<!a)" + nothing, "u");
  let line = "/(?!\\u{1F600})(?<!a)/u ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask42() {
  const forExec = new RegExp("(?!\\u{1F600})(?<!a)" + nothing, "v"), forTest = new RegExp("(?!\\u{1F600})(?<!a)" + nothing, "v"), forMatch = new RegExp("(?!\\u{1F600})(?<!a)" + nothing, "v");
  let line = "/(?!\\u{1F600})(?<!a)/v ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask43() {
  const forExec = new RegExp("\\b" + nothing, "u"), forTest = new RegExp("\\b" + nothing, "u"), forMatch = new RegExp("\\b" + nothing, "u");
  let line = "/\\b/u ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask44() {
  const forExec = new RegExp("\\b" + nothing, "v"), forTest = new RegExp("\\b" + nothing, "v"), forMatch = new RegExp("\\b" + nothing, "v");
  let line = "/\\b/v ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask45() {
  const forExec = new RegExp("(?<!a)" + nothing, "u"), forTest = new RegExp("(?<!a)" + nothing, "u"), forMatch = new RegExp("(?<!a)" + nothing, "u");
  let line = "/(?<!a)/u ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask46() {
  const forExec = new RegExp("(?<!a)" + nothing, "v"), forTest = new RegExp("(?<!a)" + nothing, "v"), forMatch = new RegExp("(?<!a)" + nothing, "v");
  let line = "/(?<!a)/v ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask47() {
  const forExec = new RegExp("x*" + nothing, "u"), forTest = new RegExp("x*" + nothing, "u"), forMatch = new RegExp("x*" + nothing, "u");
  let line = "/x*/u ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask48() {
  const forExec = new RegExp("x*" + nothing, "v"), forTest = new RegExp("x*" + nothing, "v"), forMatch = new RegExp("x*" + nothing, "v");
  let line = "/x*/v ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask49() {
  const forExec = new RegExp("\\Bb" + nothing, "u"), forTest = new RegExp("\\Bb" + nothing, "u"), forMatch = new RegExp("\\Bb" + nothing, "u");
  let line = "/\\Bb/u ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
function ask50() {
  const forExec = new RegExp("\\Bb" + nothing, "v"), forTest = new RegExp("\\Bb" + nothing, "v"), forMatch = new RegExp("\\Bb" + nothing, "v");
  let line = "/\\Bb/v ";
  for (const subject of subjects) line += show(forExec.exec(subject + nothing)) + " " + forTest.test(subject + nothing) + " " + show((subject + nothing).match(forMatch)) + " | ";
  console.log(line);
}
ask1();
ask2();
ask3();
ask4();
ask5();
ask6();
ask7();
ask8();
ask9();
ask10();
ask11();
ask12();
ask13();
ask14();
ask15();
ask16();
ask17();
ask18();
ask19();
ask20();
ask21();
ask22();
ask23();
ask24();
ask25();
ask26();
ask27();
ask28();
ask29();
ask30();
ask31();
ask32();
ask33();
ask34();
ask35();
ask36();
ask37();
ask38();
ask39();
ask40();
ask41();
ask42();
ask43();
ask44();
ask45();
ask46();
ask47();
ask48();
ask49();
ask50();
