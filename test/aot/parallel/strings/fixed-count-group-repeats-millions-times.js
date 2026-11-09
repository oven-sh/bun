// A group repeated a fixed number of times takes millions of turns, in a literal and in a pattern whose text only the run knows, and the alternative behind it is tried when a turn is missing.
// The build goes through the start of the program on real values, and both ways where a condition hangs on what only the run knows. So a text is the run's alone only where it hangs on a VALUE that only the run knows:
// here, how much is cut off in front, which is nothing.
// COUNTER: RegExpMatchesInterpreted >= 22
const atRunTime = text => text.slice(Math.min(0, process.pid));
function lengths(match) {
  return match === null
    ? "null"
    : match.index + ":" + match.map(part => (part === undefined ? "-" : part.length)).join(",");
}

const forms = [
  ["(?:ab){", "}|a"],
  ["(ab){", "}|a"],
  ["(?:(a)(b)){", "}|a"],
  ["(?:(?:ab){2}){", "}|a", 2],
  ["x?(?:ab){", "}$|a"],
  ["(?=(?:ab){", "})a|b"],
];
for (const turns of [2097152, 8388610]) {
  const text = "ab".repeat(turns);
  for (const [head, tail, inner = 1] of forms) {
    const count = turns / inner;
    if (!Number.isInteger(count)) continue;
    console.log(
      head + count + tail,
      lengths(new RegExp(atRunTime(head + count + tail)).exec(text)),
      lengths(new RegExp(atRunTime(head + (count + 1) + tail)).exec(text)),
    );
  }
}

const text = "ab".repeat(8388700);
console.log(lengths(/(?:ab){8388700}|a/.exec(text)), lengths(/(?:ab){8388701}|a/.exec(text)));
console.log(lengths(/(ab){8388700}|a/.exec(text)), lengths(/(ab){8388701}|a/.exec(text)));
