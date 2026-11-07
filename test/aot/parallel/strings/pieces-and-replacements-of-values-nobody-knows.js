// substring() and replaceAll() are called by name on values whose kind the build cannot tell, with arguments of every kind.
import vm from "node:vm";

const parsed = JSON.parse('{"short":"a","words":"hello (big) world","escaped":"print\\\\(1\\\\) and \\\\\\\\n","wide":"日本語のテキスト(語)","accents":"héllo wörld"}');
const long = parsed.words + " / " + parsed.escaped + " / " + parsed.words;
const receivers = [
  "",
  parsed.short,
  parsed.words,
  parsed.escaped,
  parsed.wide,
  parsed.accents,
  long,
  long.slice(3, 40),
  long.slice(3, 40).slice(2),
  parsed.wide + parsed.words,
  new String("boxed (text)"),
  12345.5,
  true,
  [1, "(2)", 3],
  { toString: () => "an (object)" },
  { substring: (...all) => "own substring " + all.length, replaceAll: (...all) => "own replaceAll " + all.length },
];
const indices = [
  undefined, null, -1, 0, 1, 2, 3, 7, 39, 40, 41, 1000, -1000, 1.5, -0.5, NaN, Infinity, -Infinity, "2", "x", "",
  2 ** 31 - 1, 2 ** 31, -(2 ** 31), -(2 ** 31) - 1, 2 ** 32 + 1, true, { valueOf: () => 4 }, [5],
];
const searches = [
  "", "l", "ll", "o w", "(", ")", "\\(", "\\\\", "$", "é", "語", "hello (big) world", "not there", /l/g, /[()]/g, /l/,
  undefined, null, 1, new String("l"), { [Symbol.replace]: (text, by) => "asked " + typeof text + " " + typeof by }, { toString: () => "(" },
];
const replacements = [
  "", "X", "(", "$&$&", "$1", "$$", "$`", "$'", "é", "語", (found, at) => "[" + found + "@" + at + "]", undefined, null, 7,
  new String("boxed"), { toString: () => "<object>" },
];

function attempt(run) {
  try {
    return run();
  } catch (error) {
    return error.constructor.name + ": " + error.message.split(" (In ")[0];
  }
}

function digest(values) {
  let hash = 0;
  const text = JSON.stringify(values, (key, value) => (value === undefined ? "<undefined>" : value));
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  return hash + " " + text.length;
}

for (const [number, receiver] of receivers.entries()) {
  const pieces = [attempt(() => receiver.substring())];
  for (const start of indices) {
    pieces.push(attempt(() => receiver.substring(start)));
    for (const end of indices) {
      pieces.push(attempt(() => receiver.substring(start, end)));
      pieces.push(attempt(() => receiver.substring(start, end, 1)));
    }
  }
  const replaced = [attempt(() => receiver.replaceAll()), attempt(() => receiver.replaceAll("l"))];
  for (const search of searches) {
    for (const replacement of replacements) {
      replaced.push(attempt(() => receiver.replaceAll(search, replacement)));
      replaced.push(attempt(() => receiver.replaceAll(search, replacement, "more")));
    }
  }
  console.log(number, digest(pieces), digest(replaced), pieces[40], replaced[60]);
}

// Without a receiver that has the name.
const { substring, replaceAll } = String.prototype;
for (const receiver of [undefined, null, 5, "a (text)", Symbol("s")]) {
  console.log(attempt(() => substring.call(receiver, 1, 4)), "|", attempt(() => replaceAll.call(receiver, "(", "[")));
}

// The functions of another realm, whose errors are of that realm.
const other = vm.runInNewContext("({ substring: String.prototype.substring, replaceAll: String.prototype.replaceAll, RangeError, TypeError })");
console.log(other.substring.call(parsed.words, 6, 11), other.replaceAll.call(parsed.words, "l", "L"));
const many = "x".repeat(2 ** 16);
for (const [name, method, errors] of [["here", replaceAll, globalThis], ["there", other.replaceAll, other]]) {
  try {
    method.call(many, "x", many);
    console.log(name, "no error");
  } catch (error) {
    console.log(name, error.message, error instanceof errors.RangeError, error instanceof RangeError);
  }
}

// What a rule like "Name(content)" is taken apart with, over and over.
function contentOf(rule) {
  const open = rule.indexOf("(");
  if (open < 0) return rule;
  return rule.substring(open + 1, rule.length - 1).replaceAll("\\(", "(").replaceAll("\\)", ")").replaceAll("\\\\", "\\");
}
const rules = JSON.parse('["Bash(npm run test:*)","Edit","Bash(python -c \\"print\\\\(1\\\\)\\")","Read(//home/**)","Bash(echo \\\\\\\\n)"]');
let total = 0;
for (let turn = 0; turn < 20000; turn++) total += contentOf(rules[turn % rules.length]).length;
console.log(total, rules.map(contentOf).join(" | "));
