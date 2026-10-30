// A group repeated a fixed number of times takes millions of turns in patterns made at run time that also have duplicate named groups, a class with strings or a lookbehind, and the alternative behind it is tried when a turn is missing.
function lengths(match) {
  return match === null
    ? "null"
    : match.index + ":" + match.map(part => (part === undefined ? "-" : part.length)).join(",");
}

const kinds = [
  ["(?:(?<n>x)|(?<n>y))", "", ""],
  ["x", "(?:(?<n>x)|(?<n>y))?", ""],
  ["x", "[\\q{ab|c}]?", "v"],
  ["(?<=x)", "", ""],
];
const forms = [
  ["(?:(?:ab){", "}|a)"],
  ["(?:(ab){", "}|a)"],
  ["(?:(?:(a)(b)){", "}|a)"],
  ["(?:(?:(?:ab){2}){", "}|a)", 2],
  ["(?:(?=(?:ab){", "})a|ab)"],
];
const turns = 3000000;
const text = "x" + "ab".repeat(turns);
for (const [front, behind, flags] of kinds) {
  for (const [head, tail, inner = 1] of forms) {
    const count = turns / inner;
    console.log(
      front + head + count + tail + behind,
      lengths(new RegExp(front + head + count + tail + behind, flags).exec(text)),
      lengths(new RegExp(front + head + (count + 1) + tail + behind, flags).exec(text)),
    );
  }
}

// The counts are not known until the program runs.
const none = process.argv.length - process.argv.length;
for (const [head, count, one] of [
  ["(?:ab){", 2, "abab"],
  ["c(?:ab){", 3, "cababab"],
]) {
  const source = "(?:(?<n>x)|(?<n>y))(?:" + head + (count + none) + "})*";
  console.log(source, lengths(new RegExp(source).exec("x" + one.repeat(turns / 2))));
}
