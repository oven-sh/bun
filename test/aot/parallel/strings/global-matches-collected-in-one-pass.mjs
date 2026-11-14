// The array of every match of a global pattern that has code in the image: the matches are found first, then the array is created of its full length and filled in place.
// The answers are plain Bun's: empty matches, sticky and unicode patterns, wide subjects, pieces of longer strings, a lastIndex that cannot be written, 120,000 matches, and a pattern with its own exec.
// COUNTER: RegExpMatchesCollectedInOnePass >= 100
const atRunTime = (value) => [value][Math.min(0, process.pid)];
const out = [];
const shown = (match) => (match === null ? "null" : [Array.isArray(match), match.length, JSON.stringify(match.slice(0, 30)), match.index, match.input, Object.keys(match).length].join("|"));
const patterns = [/\w+/g, /\d/g, /(\w)(\d)/g, /x*/g, /(?:)/g, /^\w/gm, /$/gm, /\b/g, /./gs, /./gu, /[^\x00-\x7f]/g, /[\p{L}]+/gv, /\w/gy, /zz/g, /(?<=a)b/g, /(?<a>a)|(?<b>b)/g, /(['"]).*?\1/g, /[^,]*/g];
const texts = ["", "a", "a1b2 c3", "foo,bar,,baz", "aaabab abcd", "\n\nline one\nline two\n", "x\u{1f600}y\u{1f600}", "café é", "'a' \"b\" 'c\"", "zzz z zz", "lone \ud83d x \ude00", "ab ".repeat(300)];
const subjects = texts.flatMap((text) => [text, atRunTime(text), atRunTime(text.slice(0, text.length >> 1)) + atRunTime(text.slice(text.length >> 1)), ("##" + atRunTime(text) + "##").slice(2, 2 + text.length), ("Ā" + text).slice(1)]);

function wordsOf(text) {
  let length = 0;
  for (const word of text.match(/\w+/g) ?? []) length += word.length;
  return length;
}
function listed(text, pattern) {
  return (text.match(pattern) || []).map((match, index) => match + index).join("~");
}
function every() {
  for (const subject of subjects) {
    out.push(wordsOf(subject));
    for (const pattern of patterns) {
      out.push(shown(subject.match(pattern)), listed(subject, pattern).slice(0, 80), pattern.lastIndex, RegExp.lastMatch, RegExp.$1);
    }
  }
}
every();

// An array that is filled in place is like any other.
const letters = atRunTime("a1 b2 c3").match(/\w\d/g);
letters.push("x");
letters[6] = "y";
out.push(letters.length, JSON.stringify(letters), letters.reverse().join(), 5 in letters);

const frozen = Object.freeze(/a/g);
const readOnly = /a/g;
Object.defineProperty(readOnly, "lastIndex", { writable: false, value: 3 });
const zero = /a/g;
Object.defineProperty(zero, "lastIndex", { writable: false, value: 0 });
for (const pattern of [frozen, readOnly, zero]) {
  for (const subject of ["a", "b", atRunTime("aa")]) {
    try {
      out.push(shown(subject.match(pattern)));
    } catch (error) {
      out.push(error.name);
    }
  }
}

const many = atRunTime("ab,").repeat(60000);
out.push(many.match(/[a-z]/g).length, many.match(/\w+/g)[59999], many.match(/,/g).join("").length);

patterns[0].exec = function (text) {
  out.push("own");
  return RegExp.prototype.exec.call(this, text);
};
out.push(shown(atRunTime("a b").match(patterns[0])));
delete patterns[0].exec;

every();

console.log(out.length, Bun.hash(out.join("~")).toString(36));
console.log(out.slice(0, 120).join(" "));
