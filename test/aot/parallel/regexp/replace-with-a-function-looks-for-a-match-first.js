// `text.replace(pattern, function)`: the stub looks for a first match and hands the text back where there is none. Every case is held against plain Bun. With code from the image and with the run time's own matcher:
// COUNTER: RegExpMatchesInterpreted >= 1600
const show = value => typeof value === "string" ? JSON.stringify(value) : String(value);
const lines = [];
const note = (...parts) => lines.push(parts.map(show).join(" "));
const any = value => [value][0];

function replaceIn(text, pattern, replacer) {
  let result;
  try { result = any(text).replace(any(pattern), any(replacer)); } catch (error) { result = "threw " + error.constructor.name + ": " + error.message; }
  return result;
}

const calls = [];
const record = (...args) => { calls.push(args.map(show).join(",")); return "<" + args[0] + ">"; };
const subjects = ["", "a", "no digits here", "a1b22c333", "x".repeat(40) + "7", "café 9", "世界 42 世", "1", "tail9"];
const rope = "left " + String(Date.now()).length + " right";
subjects.push(rope + rope, ("abc" + subjects[3]).slice(2));

const patterns = () => [/\d+/, /\d+/g, /(\d)(\d)?/g, /(?<first>\d)(?<rest>\d*)/g, /\d+/y, /\d+/gy, /z/, /z/g, /digits/, /digits/g, /^$/, /$/g, /(?:)/g, /世/g, /[^\x00-\x7f]+/gu, /\d+$/m, /A/i, /(a)|(b)/g];
for (const subject of subjects) {
  for (const pattern of patterns()) {
    calls.length = 0;
    pattern.lastIndex = 1;
    note(pattern.source, pattern.flags, subject, replaceIn(subject, pattern, record), pattern.lastIndex, calls.join(";"));
  }
}

// What the function gives back, and what it does.
note(replaceIn("a1b2", /\d/g, () => undefined), replaceIn("a1b2", /\d/g, () => 7), replaceIn("a1b2", /\d/g, () => ({ toString() { return "$&"; } })), replaceIn("a1b2", /\d/g, () => "$1$&"));
note(replaceIn("a1b2", /\d/g, () => { throw new RangeError("from the function"); }), replaceIn("ab", /\d/g, () => { throw new RangeError("never called"); }));
note(replaceIn("a1b2", /\d/g, () => Symbol("no text")));
{
  const pattern = /\d/g;
  note(replaceIn("a1b2c3", pattern, digit => { pattern.lastIndex = 5; return "#" + digit; }), pattern.lastIndex);
  note(replaceIn("abc", pattern, () => "never"), pattern.lastIndex);
}
{
  const pattern = /\d/g;
  note(replaceIn("a1b2c3", pattern, digit => { pattern.compile("[a-z]", "g"); return "#" + digit; }), pattern.source);
}

// A pattern that is no longer as it was made.
{
  const frozen = Object.freeze(/\d/g);
  note(replaceIn("a1", frozen, record), replaceIn("ab", frozen, record), frozen.lastIndex);
  const frozenOnce = Object.freeze(/\d/);
  note(replaceIn("a1", frozenOnce, record), replaceIn("ab", frozenOnce, record));
  const odd = /\d/g; odd.lastIndex = { valueOf() { lines.push("lastIndex was asked"); return 0; } };
  note(replaceIn("a1", odd, record), replaceIn("ab", odd, record), typeof odd.lastIndex);
  const oddSticky = /\d/y; oddSticky.lastIndex = "1";
  note(replaceIn("a1", oddSticky, record), oddSticky.lastIndex);
  const own = /\d/g; own.exec = () => null;
  note(replaceIn("a1", own, record));
  const ownReplace = /\d/g; ownReplace[Symbol.replace] = (text, replacer) => "own " + text + " " + typeof replacer;
  note(replaceIn("a1", ownReplace, record));
  class Sub extends RegExp { exec(text) { lines.push("exec of the subclass"); return super.exec(text); } }
  note(replaceIn("a1", new Sub("\\d", "g"), record), replaceIn("ab", new Sub("\\d", "g"), record));
  const flagged = /\d/g; Object.defineProperty(flagged, "flags", { value: "" });
  note(replaceIn("a1b2", flagged, record), flagged.lastIndex);
}

// Callables of other kinds, and what is no function.
note(replaceIn("a1b2", /\d/g, String), replaceIn("a1b2", /\d/g, Math.max), replaceIn("a1b2", /\d/g, record.bind(null, "bound")), replaceIn("ab", /\d/g, String));
note(replaceIn("a1b2", /\d/g, new Proxy(record, {})), replaceIn("a1b2", /\d/g, class { }), replaceIn("ab", /\d/g, class { }));
note(replaceIn("a1b2", /\d/g, async digit => digit), replaceIn("a1b2", /\d/g, function* () { }));
note(replaceIn("a1b2", /\d/g, { call() { } }), replaceIn("a1b2", /\d/g, null), replaceIn("a1b2", /\d/g, undefined), replaceIn("a1b2", /\d/g, 5));

// The legacy statics say what matched last.
replaceIn("k5", /(\d)/, record); note(RegExp.$1, RegExp.lastMatch, RegExp.leftContext);
replaceIn("none", /(\d)/, record); note(RegExp.$1, RegExp.lastMatch, RegExp.leftContext);

// Many patterns over one text, most of which find nothing. The build knows the text of every other pair; of the rest only the run does: how much is cut off in front hangs on a number that only the run knows, and is nothing.
{
  const many = []; for (let i = 0; i < 64; i++) many.push(new RegExp(("w" + i + "(\\d+)").slice(i & 2 ? Math.min(0, process.pid) : 0), i & 1 ? "g" : ""));
  let text = "w3(no) w5 12 w7x w9 w11", count = 0;
  for (let round = 0; round < 50; round++) for (const pattern of many) text = text.replace(pattern, (all, digits) => { count += digits.length; return all; });
  note(text, count);
}
console.log(lines.join("\n"));
