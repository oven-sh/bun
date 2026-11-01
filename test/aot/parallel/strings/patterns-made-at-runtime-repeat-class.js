// A pattern that the program puts together at run time is parsed at run time. One whose character classes repeat matches as if each class had been written once:
// behind quantifiers, negated, with other flags in force, in lookbehinds, beside classes that only begin alike, and where the pattern is refused.
const unseen = new Function("x", "return x");
const invisible = unseen("[\\u00ad\\u034f\\u200b-\\u200f\\ufeff]");

function spaced(word, between) {
  return word.split("").join(between);
}

function show(title, source, flags, subjects) {
  let made;
  try {
    made = new RegExp(unseen(source), flags);
  } catch (error) {
    console.log(title + ": " + error.name);
    return;
  }
  const answers = subjects.map(subject => {
    made.lastIndex = 0;
    const match = made.exec(subject);
    return match ? match.index + ":" + JSON.stringify(Array.from(match)) : "no";
  });
  console.log(title + ": " + made.source.length + " " + made.flags + " " + answers.join(" "));
}

const hidden = "s​e­c﻿‏ret";
show("one class behind every letter", spaced("secret", invisible + "*"), "", ["secret", hidden, "x" + hidden + "y", "secre", "s e c r e t"]);
show("the same, ignoring case", spaced("secret", invisible + "*"), "i", ["SECRET", hidden.toUpperCase(), "sECret"]);
show("the same, unicode", spaced("secret", invisible + "*"), "u", ["secret", hidden]);
show("other quantifiers on each", "a[xy]b[xy]?c[xy]+d[xy]{2}e[xy]*?f", "", ["axbcxdxyef", "aybxcyydyyeyf", "axbcdxyef"]);
show("captured", "([ab])([ab])([ab])", "", ["aba", "bbb", "ab"]);
show("side by side", "[ab][ab][ab][ab]", "", ["abab", "aab", "xbaaby"]);
show("negated", "[^ab][^ab][ab][ab][^ab]", "", ["xyabz", "xyaba", "abxyabz"]);
show("only begins alike", "[ab][ab]c][abc][ab-][ab]", "", ["abc]c-a", "aac]aba", "abc]cab"]);
show("closing bracket escaped", "[\\]a][\\]a][\\]a]b", "", ["]a]b", "aaab", "]]b"]);
show("case folded for a part", "[a-c](?i:[a-c][a-c])[a-c]", "", ["aBCa", "aBCA", "ABCa", "abca"]);
show("case exact for a part", "[a-c](?-i:[a-c][a-c])[a-c]", "i", ["AbcA", "ABCA", "abca"]);
show("in a lookbehind", "(?<=[ab][ab])[ab][ab]", "", ["abab", "xaba", "aab"]);
show("in alternatives", "[ab][ab]x|[ab][ab]y|[cd][cd]", "", ["aby", "bax", "dc", "abz"]);
show("with a named group", "(?<first>[ab][ab])\\k<first>[ab][ab]", "", ["ababba", "abbaab"]);
show("escapes inside", "[\\d\\s][\\d\\s][\\w-][\\w-]", "", ["1 a-", " 2--", "12  "]);
show("astral, unicode", "[\\u{1f600}-\\u{1f64f}][\\u{1f600}-\\u{1f64f}]", "u", ["\u{1f600}\u{1f601}", "\u{1f600}x"]);
show("surrogates, no unicode", "[\\ud83d][\\ud83d][\\ude00]", "", ["\ud83d😀", "😀"]);
show("range out of order, twice", "[b-a][b-a]", "", []);
show("second class is cut off", "[ab][ab", "", []);
show("second range is out of order", "[a-c][a-c][c-a]", "", []);
show("bad escape, unicode", "[\\q][\\q]", "u", []);
show("empty classes", "a[][]b|[^][^]", "", ["ab", "xy"]);

const many = spaced("abcdefghijklmnopqrstuvwxyz".repeat(8), invisible + "*");
const text = "abcdefghijklmnopqrstuvwxyz".repeat(8);
show("two hundred classes", many, "", [text, spaced(text, "​"), text.slice(1)].map(subject => subject));
console.log(new RegExp(unseen(many), "g")[Symbol.replace](spaced(text, "﻿") + "!" + text, "<$&>").length);
