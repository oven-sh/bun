// A pattern whose text the build predicts has to earn its code for 16-bit subjects. One that has to match its subject from end to end with characters of one byte (an address, a version, a name)
// matches no subject with a wider character: it has code for 8-bit subjects alone, half the bytes. A 16-bit subject compiles it at run time, once, and the answer is the same. Every other
// predicted pattern, and every literal, has both.
// COUNTER: RegExpsCreatedWithoutRecord = 0
// COUNTER: RegExpsCompiledToBytecode = 1
// COUNTER: RegExpMatchesInterpreted >= 2
const RULES = [
  { source: "([a-z]+)-([a-z]+)", flags: "" },
  { source: "[a-z]+[0-9]", flags: "g" },
  { source: "^(?:[a-z]+|[0-9]{1,3}(?:\\.[0-9]{1,3}){3})$", flags: "" },
  { source: "^[a-z\u2500]+$", flags: "" },
  { source: "^[^0-9]+$", flags: "" },
  { source: "^[a-z]+$", flags: "i" },
  { source: "^[a-z]+$", flags: "m" },
];
const [inside, insideGlobal, whole, wholeWithWide, wholeInverted, wholeIgnoringCase, wholeOfLine] = RULES.map(rule => new RegExp(rule.source, rule.flags));
const literal = /^(?:[a-z]+|[0-9]{1,2})$/;

const narrow = "one-two three4 five6";
const wide = "\u2500 one-two \u2502 three4 five6 \u{1f600}";
// 16 bits a character, and none of them is wide.
const wideOnlyByStorage = (wide + "abc").slice(-3);

console.log(inside.exec(narrow)?.join(), inside.exec(wide)?.join(), inside.exec(wide)?.index);
console.log(narrow.match(insideGlobal)?.join(), wide.match(insideGlobal)?.join());
console.log(narrow.replace(inside, "$2-$1"), wide.replace(inside, "$2-$1"));
console.log(whole.test("abc"), whole.test("10.0.0.1"), whole.test("ab c"), whole.test(wide), whole.test(wideOnlyByStorage), whole.test("abc\u2500"));
console.log(wholeWithWide.test("ab\u2500"), wholeInverted.test(wide), wholeInverted.test("\u2500\u2502"), wholeIgnoringCase.test("\u212a"), wholeOfLine.test("\u2500\nabc"));
console.log(literal.test("abc"), literal.test(wideOnlyByStorage), literal.test(wide));
