// A literal with the flag u whose matches begin with a character outside ASCII: on a subject of 16-bit characters too there is a search for the first character of a match, which passes over ASCII many characters at a time.
// Env of the build: BUN_JSC_verboseRegExpCompilation=1
// Build prints: 3 x Searches for the first character of a match
const invisible = /[\p{Cf}\p{Variation_Selector}]/gu;
const length = 400000;
const ascii = "\u4e00" + "the quick brown fox ".repeat(length / 20);
let tested = "";
for (let i = 0; i <= length; i += 100)
  tested += "\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341".repeat(10);
for (const subject of [ascii, tested, ascii + "\u200b" + ascii, tested + "\ufe0f"])
  console.log(subject.length, subject.replace(invisible, "").length);
