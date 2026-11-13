// new RegExp of a pattern that is put together at run time: the pattern is read out of the rope and found among the patterns created before, and the rope stays unresolved.
// The answers are plain Bun's: flags, wide patterns, substrings, patterns of the image, invalid patterns, deep ropes, objects of their own with a lastIndex of their own, and patterns behind a collection.
// COUNTER: RegExpPatternsFoundByRope >= 90
const atRunTime = (value) => [value][Math.min(0, process.pid)];
const out = [];
const show = (value) => (value === null ? "null" : Array.isArray(value) ? "[" + value.map(show).join(",") + "]@" + value.index : String(value));
const text = (f) => { try { return show(f()); } catch (error) { return error.constructor.name + ": " + error.message; } };

function currency(options) {
  let digits = "\\d{".concat(options.digits[0], "}");
  options.digits.forEach((digit, index) => { if (index !== 0) digits = "".concat(digits, "|\\d{").concat(digit, "}"); });
  const symbol = "(".concat(options.symbol.replace(/\W/g, (m) => "\\".concat(m)), ")").concat(options.required ? "" : "?");
  const amount = "([1-9]\\d{0,2}(\\".concat(options.separator, "\\d{3})*|0|[1-9]\\d*)?");
  const decimals = "(\\".concat(options.point, "(").concat(digits, "))").concat(options.needsPoint ? "" : "?");
  let pattern = amount + (options.required || options.digits ? decimals : "");
  if (options.flags === "i") pattern = " ?".concat(pattern);
  pattern = symbol + pattern;
  if (!options.needsPoint) pattern = "-?" + pattern;
  switch (options.flags) {
    case "i": return new RegExp("^(?!-? )(?=.*\\d)".concat(pattern, "$"), "i");
    case "g": return new RegExp("^(?!-? )(?=.*\\d)".concat(pattern, "$"), "g");
    case "y": return new RegExp("^(?!-? )(?=.*\\d)".concat(pattern, "$"), "y");
    case "im": return new RegExp("^(?!-? )(?=.*\\d)".concat(pattern, "$"), "im");
  }
  return new RegExp("^(?!-? )(?=.*\\d)".concat(pattern, "$"));
}

const symbols = ["$", "£", "€", "kr", "R$", "￥"];
const subjects = ["$10,123.45", "10123", "£1", "€0.10", "kr 5", "R$1,000", "$.99", "￥1,000,000.1", "", "x"];
const regExps = [];
for (let round = 0; round < 12; round++) {
  for (const symbol of symbols) {
    for (const flags of [undefined, "i", "g", "y", "im"]) {
      const regExp = currency({ symbol, digits: round % 2 ? [2] : [1, 2, 3], required: round % 3 === 0, separator: ",", point: ".", needsPoint: false, flags });
      if (round < 4) regExps.push(regExp);
      out.push(subjects.map((subject) => text(() => regExp.exec(subject))).join(" "), regExp.source.length, regExp.flags, regExp.lastIndex);
    }
  }
  if (round % 4 === 3) Bun.gc(true);
}
// Ropes of every depth and width, each pattern several times.
const join = atRunTime((a, b) => a + b), join3 = atRunTime((a, b, c) => a + b + c);
const tail = atRunTime("(?:abcdefghij|klmnopqrst|uvwxyz){0,3}(?=.|$)(?:0123456789|[a-f]{2,}|[^a-z0-9]){0,5}");
for (let round = 0; round < 40; round++) {
  const word = "word" + (round % 8), wide = round % 3 ? "" : "|\u0416" + (round % 2);
  const left = join(join(join("^(", word), wide), join(")", tail));
  const right = join3("(?:", join3(word, "|", tail), ")" + wide);
  out.push(text(() => new RegExp(left).exec(word + "ab!")), text(() => new RegExp(left, "i").exec(word.toUpperCase())), text(() => new RegExp(right, "g").test(word)), text(() => new RegExp(join(left, right)).source.length), text(() => "x-" + "x".replace(new RegExp(join("^", right)), "-")));
}

// Each is an object of its own.
out.push(new Set(regExps).size, regExps.every((regExp) => regExp.constructor === RegExp && Object.getPrototypeOf(regExp) === RegExp.prototype && Object.keys(regExp).length === 0));
const one = new RegExp(atRunTime("a") + atRunTime("+") + atRunTime("b"), "g");
const two = new RegExp(atRunTime("a") + atRunTime("+") + atRunTime("b"), "g");
one.lastIndex = 2;
one.extra = 1;
out.push(one === two, two.lastIndex, two.extra, text(() => one.exec("aabaab")), text(() => two.exec("aabaab")), one.lastIndex, two.lastIndex);

// Patterns of the image, as literals and as constants.
for (let i = 0; i < 4; i++) {
  out.push(text(() => /in the (image)/.exec("in the image")), text(() => new RegExp(atRunTime("in the ") + atRunTime("(image)")).exec("in the image")), text(() => new RegExp("constant " + "pattern").test("constant pattern")));
}
// Invalid patterns and flags throw every time.
for (let i = 0; i < 3; i++) {
  out.push(text(() => new RegExp(atRunTime("(") + atRunTime("a") + i)), text(() => new RegExp(atRunTime("a") + atRunTime("b"), atRunTime("gg"))), text(() => new RegExp(atRunTime("[z-") + atRunTime("a]"))), text(() => new RegExp(atRunTime("\\u{1F600") + atRunTime("}"), "u").test("\u{1F600}")));
}
// Escapes, slashes, line ends, the empty pattern, substrings, deep ropes, long patterns.
let deep = atRunTime("");
for (let i = 0; i < 60; i++) deep = i % 2 ? deep + "a" : "b" + deep;
let left = "";
for (let i = 0; i < 300; i++) left += atRunTime("a?");
const pieces = atRunTime("xx(abc)|(Ж)yy");
for (let i = 0; i < 3; i++) {
  out.push(new RegExp(atRunTime("a/") + atRunTime("b\n") + "c").source, new RegExp(atRunTime("") + atRunTime("")).source, String(new RegExp(pieces.slice(2, 7))), text(() => new RegExp(pieces.slice(8, 11) + pieces.slice(2, 4))), text(() => new RegExp(pieces.slice(8, 11) + pieces.slice(2, 7))), text(() => new RegExp(deep + atRunTime("+")).exec("b".repeat(30) + "a".repeat(40))), text(() => new RegExp("^" + left + "$").test("a".repeat(299))), text(() => new RegExp(atRunTime("x".repeat(2100)) + atRunTime("y")).test("x".repeat(2100) + "y")), text(() => new RegExp(atRunTime("Ж".repeat(1100)) + atRunTime("y")).test("Ж".repeat(1100) + "y")));
}
// The same text in 8 and in 16 bits.
const wide = ("Ж" + "café").slice(1);
for (let i = 0; i < 3; i++) out.push(new RegExp(atRunTime(wide) + atRunTime("+")).test("caféé"), new RegExp(atRunTime("café") + atRunTime("+")).test("caféé"), new RegExp(atRunTime(wide) + atRunTime("+"), "i").flags);
class Own extends RegExp { get own() { return true; } }
out.push(new Own(atRunTime("a") + atRunTime("+b")).own, RegExp(atRunTime("a") + atRunTime("+b")).test("aab"), text(() => Reflect.construct(RegExp, [atRunTime("a") + atRunTime("+b")], Own).own));
console.log(out.length, Bun.hash(out.join("~")).toString(36));
console.log(out.slice(0, 12).join(" | ").slice(0, 600));
