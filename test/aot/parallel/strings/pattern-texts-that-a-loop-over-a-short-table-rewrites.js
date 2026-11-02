// The text of a pattern goes through a loop over a table that never changes: each turn makes the next text of the last one and of one row. The build knows the table, so it knows the text
// behind the loop, and the pattern's code is in the image.
// KNOWN rows ^\s{0,1}(\d{1,256})\.(\d{1,256})$
// KNOWN rows ^v?[a-zA-Z0-9-]{1,250}\s{1,1}$
// KNOWN counted ^<b><i>x</i></b>$
// KNOWN backwards ^c-b-a-$
// KNOWN steps ^(?:ace)$
// KNOWN inlined ^one, two, three$
// KNOWN pieces ^(?:b|3)$
// UNKNOWN ^year
// COUNTER: RegExpsCreatedWithoutRecord = 1

// Every row names a token and a bound. `*` and `+` behind the token get the bound.
const LETTERS = "[a-zA-Z0-9-]";
const bounds = [
  ["\\s", 1],
  ["\\d", 256],
  [LETTERS, 250],
];
const withBounds = text => {
  for (const [token, most] of bounds) {
    text = text.split(`${token}*`).join(`${token}{0,${most}}`).split(`${token}+`).join(`${token}{1,${most}}`);
  }
  return text;
};
const bounded = [];
function define(text, isGlobal) {
  bounded.push(new RegExp(withBounds(text), isGlobal ? "g" : undefined));
}
define("^\\s*(\\d+)\\.(\\d+)$");
define("^v?[a-zA-Z0-9-]+\\s+$", true);

// A counter in place of `of`.
const tags = ["i", "b"];
function wrapped(text) {
  for (let index = 0; index < tags.length; index++) text = "<" + tags[index] + ">" + text + "</" + tags[index] + ">";
  return text;
}
const counted = new RegExp("^" + wrapped("x") + "$");

// From the last row to the first.
const letters = ["a", "b", "c"];
function reversed() {
  let text = "";
  for (let index = letters.length - 1; index >= 0; index--) text = text + letters[index] + "-";
  return text;
}
const backwards = new RegExp("^" + reversed() + "$");

// Every second row.
const alphabet = ["a", "b", "c", "d", "e"];
function everySecond() {
  let text = "";
  for (let index = 0; index < alphabet.length; index += 2) text = text + alphabet[index];
  return text;
}
const steps = new RegExp("^(?:" + everySecond() + ")$");

// The loop and the pattern in one body.
const words = [
  ["1", "one"],
  ["2", "two"],
  ["3", "three"],
];
let sentence = "^1, 2, 3$";
for (const [digit, word] of words) sentence = sentence.split(digit).join(word);
const inlined = new RegExp(sentence);

// What split() gives is a list like any other: it has a length and elements.
const parts = "a,b,c".split(",");
const pieces = new RegExp("^(?:" + parts[1] + "|" + parts.length + ")$");

// The table is known and the text that enters the loop is not.
let dated = "^year-" + new Date(0).getUTCFullYear() + "$";
for (const [digit, word] of words) dated = dated.split(digit).join(word);
const unknown = new RegExp(dated);

for (const pattern of bounded) console.log(pattern.source, pattern.flags, pattern.test(" 12.5"), pattern.test("vabc "));
console.log(counted.source, counted.test("<b><i>x</i></b>"));
console.log(backwards.source, backwards.test("c-b-a-"));
console.log(steps.source, steps.test("ace"));
console.log(inlined.source, inlined.test("one, two, three"));
console.log(pieces.source, pieces.test("b"), pieces.test("3"), pieces.test("a"));
console.log(unknown.source, unknown.test("year-one970"));
