import vm from "node:vm";

const parsed = JSON.parse(
  '{"short":"a","words":"Hello (big) world","spaced":"  \\t padded text \\n ","list":"a,b,,c d,e","wide":"日本語のテキスト,語","pair":"x😀y","accents":"héllo wörld"}',
);
const long = parsed.words + " / " + parsed.list + " / " + parsed.words;

class Named extends RegExp {}
class Loud extends RegExp {
  exec(text) {
    notes.push("exec " + text.length);
    return super.exec(text);
  }
}
const notes = [];

function patterns() {
  const withOwnExec = /l+/;
  withOwnExec.exec = text => (notes.push("own exec " + text.length), null);
  const withOwnName = /l+/g;
  withOwnName.extra = 1;
  const startsLate = /l/g;
  startsLate.lastIndex = 5;
  const sticky = /l/y;
  sticky.lastIndex = 2;
  const asksForIndex = /l/g;
  asksForIndex.lastIndex = { valueOf: () => (notes.push("lastIndex read"), 3) };
  const frozen = Object.freeze(/l/g);
  const replacesItself = /l/;
  replacesItself[Symbol.replace] = (text, by) => "own @@replace " + typeof by;
  replacesItself[Symbol.split] = text => ["own @@split"];
  replacesItself[Symbol.match] = text => ["own @@match"];
  return [
    /l/,
    /l+/g,
    /(o)\s*(w)?/,
    /(?<letter>[a-c]),/g,
    /,|\s/,
    /not there/,
    /not there/g,
    /^/,
    /$/g,
    /(?:)/g,
    /語/u,
    /./su,
    /L/i,
    new RegExp(parsed.short),
    new RegExp("[" + parsed.short + "-c]", "g"),
    new Named("l", "g"),
    new Loud("l"),
    withOwnExec,
    withOwnName,
    startsLate,
    sticky,
    asksForIndex,
    frozen,
    replacesItself,
  ];
}

const texts = [
  "",
  parsed.short,
  parsed.words,
  parsed.spaced,
  parsed.list,
  parsed.wide,
  parsed.pair,
  parsed.accents,
  long,
  long.slice(3, 40),
  long.slice(3, 40).slice(2),
  parsed.wide + parsed.words,
];
const others = [
  new String("boxed, text"),
  12345.5,
  true,
  [1, "l,2", 3],
  { toString: () => "an object, l" },
  undefined,
  null,
  Symbol("s"),
  10n,
  () => "l",
];
const impostor = {};
for (const name of ["replace", "split", "includes", "endsWith", "charAt", "charCodeAt", "codePointAt", "toUpperCase", "trimStart", "trimEnd", "match", "test", "exec"])
  impostor[name] = (...all) => "own " + name + " " + all.length;
const indices = [undefined, null, -1, 0, 1, 2, 7, 16, 17, 1000, 1.5, -0.5, NaN, Infinity, "2", "x", 2 ** 31, -(2 ** 31), 2 ** 32 + 1, true, { valueOf: () => 4 }, [5]];
const replacements = ["", "X", "$&$&", "$1|$2", "$<letter>", "$$", "$`", "$'", "語", (found, ...rest) => "[" + found + "@" + rest.length + "]", undefined, null, 7, { toString: () => "<object>" }];

function attempt(run) {
  try {
    return run();
  } catch (error) {
    return error.constructor.name + ": " + error.message.split(" (In ")[0];
  }
}

function shown(value) {
  if (Array.isArray(value)) return { elements: [...value], index: value.index, input: value.input, groups: value.groups && { ...value.groups } };
  return value;
}

function digest(values) {
  let hash = 0;
  const text = JSON.stringify(values, (key, value) => (value === undefined ? "<undefined>" : typeof value === "bigint" || typeof value === "symbol" ? String(value) : value));
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  return hash + " " + text.length;
}

const left = () => [RegExp.lastMatch, RegExp.$1, RegExp.leftContext.length, RegExp.rightContext.length].join("~");

for (const [number, receiver] of [...texts, ...others, impostor].entries()) {
  const read = [];
  for (const index of indices) {
    read.push(attempt(() => receiver.charAt(index)), attempt(() => receiver.charCodeAt(index)), attempt(() => receiver.codePointAt(index)));
    read.push(attempt(() => receiver.charAt(index, 1)), attempt(() => receiver.charCodeAt(index, 1)), attempt(() => receiver.codePointAt(index, 1)));
  }
  read.push(attempt(() => receiver.charAt()), attempt(() => receiver.charCodeAt()), attempt(() => receiver.codePointAt()));

  const converted = [
    attempt(() => receiver.toUpperCase()),
    attempt(() => receiver.trimStart()),
    attempt(() => receiver.trimEnd()),
    attempt(() => receiver.toUpperCase(1)),
    attempt(() => receiver.trimStart(1)),
    attempt(() => receiver.trimEnd(1)),
  ];

  const sought = [];
  for (const search of [...texts, ...others, ...patterns(), "l", "ld", ",", " ", "d"]) {
    sought.push(attempt(() => receiver.includes(search)), attempt(() => receiver.endsWith(search)));
    sought.push(attempt(() => receiver.includes(search, 2)), attempt(() => receiver.endsWith(search, 5)));
    sought.push(attempt(() => receiver.split(search)), attempt(() => receiver.split(search, 2)), attempt(() => receiver.split(search, undefined)));
    sought.push(attempt(() => shown(receiver.match(search))), typeof search === "object" && search !== null ? String(search.lastIndex) : "", left());
  }
  sought.push(attempt(() => receiver.includes()), attempt(() => receiver.endsWith()), attempt(() => receiver.split()), attempt(() => shown(receiver.match())));

  const replaced = [attempt(() => receiver.replace()), attempt(() => receiver.replace("l"))];
  for (const replacement of replacements) {
    for (const search of [...patterns(), "", "l", "o w", "(", "$", "語", "not there", undefined, null, 1, new String("l"), { toString: () => "(" }]) {
      replaced.push(attempt(() => receiver.replace(search, replacement)), attempt(() => receiver.replace(search, replacement, "more")));
      replaced.push(typeof search === "object" && search !== null ? String(search.lastIndex) : "", left());
    }
  }
  console.log(number, digest(read), digest(converted), digest(sought), digest(replaced), digest(notes.splice(0)));
}

for (const [number, receiver] of [...patterns(), ...others, impostor, parsed.words].entries()) {
  const matched = [];
  for (const text of [...texts, ...others]) {
    matched.push(attempt(() => receiver.test(text)), attempt(() => String(receiver.lastIndex)), left());
    matched.push(attempt(() => shown(receiver.exec(text))), attempt(() => String(receiver.lastIndex)), left());
    matched.push(attempt(() => receiver.test(text, 1)), attempt(() => shown(receiver.exec(text, 1))));
  }
  matched.push(attempt(() => receiver.test()), attempt(() => shown(receiver.exec())));
  console.log("pattern", number, digest(matched), digest(notes.splice(0)));
}

const { replace, split, includes, endsWith, charAt, charCodeAt, codePointAt, toUpperCase, trimStart, trimEnd, match } = String.prototype;
const { test, exec } = RegExp.prototype;
for (const receiver of [undefined, null, 5, "a (text), l", Symbol("s"), /l/g]) {
  console.log(
    [
      attempt(() => replace.call(receiver, /\(/, "[")),
      attempt(() => replace.call(receiver, "(", "[")),
      attempt(() => split.call(receiver, ",")),
      attempt(() => split.call(receiver, /,/)),
      attempt(() => includes.call(receiver, "t")),
      attempt(() => endsWith.call(receiver, "l")),
      attempt(() => charAt.call(receiver, 1)),
      attempt(() => charCodeAt.call(receiver, 1)),
      attempt(() => codePointAt.call(receiver, 1)),
      attempt(() => toUpperCase.call(receiver)),
      attempt(() => trimStart.call(receiver)),
      attempt(() => trimEnd.call(receiver)),
      attempt(() => shown(match.call(receiver, /t/))),
      attempt(() => test.call(receiver, "all")),
      attempt(() => shown(exec.call(receiver, "all"))),
    ]
      .map(value => JSON.stringify(value) ?? "undefined")
      .join(" | "),
  );
}

const other = vm.runInNewContext(
  "({ split: String.prototype.split, replace: String.prototype.replace, match: String.prototype.match, exec: RegExp.prototype.exec, test: RegExp.prototype.test, pattern: /l+/, every: /l/g, Array })",
);
console.log(
  other.split.call(parsed.list, ",") instanceof other.Array,
  other.split.call(parsed.list, ",") instanceof Array,
  parsed.list.split(other.pattern) instanceof Array,
  other.split.call(parsed.list, /,/) instanceof other.Array,
  other.match.call(parsed.words, /l/) instanceof other.Array,
  parsed.words.match(other.pattern) instanceof other.Array,
  other.exec.call(/l/, parsed.words) instanceof other.Array,
  other.exec.call(other.pattern, parsed.words) instanceof other.Array,
  /l/.exec.call(other.pattern, parsed.words) instanceof Array,
  other.test.call(/l/, parsed.words),
  /l/.test.call(other.every, parsed.words),
  other.every.lastIndex,
  other.replace.call(parsed.words, /l+/, "L"),
  parsed.words.replace(other.every, "L"),
  other.every.lastIndex,
);

function framesAbove(text, search) {
  let frames;
  text.replace(search, () => ((frames = new Error("here").stack.split("\n").slice(1, 4).map(line => line.trim().split(" (")[0])), ""));
  return frames;
}
console.log(framesAbove(parsed.words, /l/), framesAbove(parsed.words, "l"), framesAbove(parsed.words, /never/));

function entriesOf(line) {
  const entries = [];
  for (const part of line.split(";")) {
    const trimmed = part.trimStart().trimEnd();
    if (!trimmed.includes("=") || trimmed.endsWith("=")) continue;
    const [name, value] = trimmed.split(/\s*=\s*/);
    if (!/^[a-z]/i.test(name) || name.charCodeAt(0) === 35 || name.charAt(0) === "_") continue;
    const unit = /(\d+)(ms|s)$/.exec(value);
    entries.push(name.toUpperCase().replace(/-/g, "_") + ":" + (unit ? unit[1] + unit[2].codePointAt(0) : value.replace(/^"|"$/g, "").replace("\\n", "\n").match(/\w+/)?.[0]));
  }
  return entries;
}
const lines = JSON.parse('["retry-count = 3; time-out=250ms ;_hidden=1; #note = x; empty=","name = \\"first second\\"; wait = 2s; broken","", "a=b;c = d\\\\ne; é=1"]');
let total = 0;
for (let turn = 0; turn < 20000; turn++) total += entriesOf(lines[turn % lines.length]).length;
console.log(total, lines.map(entriesOf).join(" | "));
