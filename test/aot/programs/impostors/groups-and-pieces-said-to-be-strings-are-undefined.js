function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (ArrayBuffer.isView(value)) return value.constructor.name + "<" + Array.prototype.join.call(value, " ") + ">";
  let text;
  try {
    text = String.prototype.valueOf.call(value);
  } catch {
    const parts = [];
    for (const key of Reflect.ownKeys(value)) parts.push(String(key) + ": " + show(value[key]));
    return "{" + parts.join(", ") + "}";
  }
  return "String object " + JSON.stringify(text);
}

function attempt(label, run) {
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + " -> " + line);
}

function make(text) {
  return (0, eval)("(" + text + ")");
}

function secondGroup(text) {
  const found = /(a)|(b)/.exec(text);
  return found === null ? "no match" : [typeof found[1], typeof found[2], found.length];
}

function secondGroupLength(text) {
  return /(a)|(b)/.exec(text)[2].length;
}

function secondGroupUpper(text) {
  const [, first, second] = /(a)|(b)/.exec(text);
  return second.toUpperCase() + first;
}

function secondGroupLabel(text) {
  const found = text.match(/(a)|(b)/);
  return "<" + found[1] + "|" + found[2] + ">";
}

function groupPastTheEnd(text) {
  return /(a)/.exec(text)[5];
}

function namedGroupLength(text) {
  return /(?<first>a)|(?<second>b)/.exec(text).groups.second.length;
}

function groupsOfAPatternWithoutNames(text) {
  return typeof /(a)/.exec(text).groups;
}

function matchLength(text) {
  return text.match(/x+/).length;
}

function everyMatchLength(text) {
  return text.match(/x/g).length;
}

function pieceLengths(text) {
  return text.split(/(-)?,/).map(piece => (piece === undefined ? "undefined" : piece.length));
}

function secondPieceLength(text) {
  return text.split(/(-)?,/)[1].length;
}

function pieceUpper(text, index) {
  return text.split(",")[index].toUpperCase();
}

function limitedPiece(text) {
  return text.split(",", 1)[1];
}

function groupsOfEveryMatch(text) {
  const seen = [];
  for (const found of text.matchAll(/(a)|(b)/g)) seen.push(typeof found[1] + " " + typeof found[2]);
  return seen;
}

function groupLengthsOfEveryMatch(text) {
  const seen = [];
  for (const [, first] of text.matchAll(/(a)|(b)/g)) seen.push(first.length);
  return seen;
}

function replacedByGroups(text) {
  return text.replace(/(a)|(b)/g, (match, first, second) => "[" + typeof first + typeof second + "]");
}

function replacedByGroupLength(text) {
  return text.replace(/(a)|(b)/g, (match, first) => first.length);
}

function replacedByDollar(text) {
  return text.replace(/(a)|(b)/g, "[$1|$2|$3]");
}

function legacyStatics(text) {
  /(a)|(b)/.exec(text);
  return [typeof RegExp.$1, RegExp.$1, typeof RegExp.$2, RegExp.$2, RegExp.lastMatch];
}

function indices(text) {
  const found = /(a)|(b)/d.exec(text);
  return [found.indices[1], found.indices[2]];
}

const uses = [
  ["second group", secondGroup],
  ["second group length", secondGroupLength],
  ["second group upper", secondGroupUpper],
  ["second group label", secondGroupLabel],
  ["group past the end", groupPastTheEnd],
  ["named group length", namedGroupLength],
  ["groups without names", groupsOfAPatternWithoutNames],
  ["match length", matchLength],
  ["every match length", everyMatchLength],
  ["piece lengths", pieceLengths],
  ["second piece length", secondPieceLength],
  ["piece 1 upper", text => pieceUpper(text, 1)],
  ["limited piece", limitedPiece],
  ["groups of every match", groupsOfEveryMatch],
  ["group lengths of every match", groupLengthsOfEveryMatch],
  ["replaced by groups", replacedByGroups],
  ["replaced by group length", replacedByGroupLength],
  ["replaced by dollar", replacedByDollar],
  ["legacy statics", legacyStatics],
  ["indices", indices],
];

for (let i = 0; i < 2000; i++) {
  secondGroup("b");
  secondGroupLength("b");
  secondGroupLabel("b");
  namedGroupLength("b");
  matchLength("xx");
  everyMatchLength("xx");
  pieceLengths("p-,q");
  secondPieceLength("p-,q");
  pieceUpper("p,q", 1);
  groupsOfEveryMatch("ab");
  groupLengthsOfEveryMatch("aa");
  replacedByGroups("ab");
  replacedByGroupLength("aa");
  replacedByDollar("ab");
}

for (const text of ["a", "b", "ab", "ba", "c", "", "xx", "p,q", "p-,q", "p", "a,b-,c"]) {
  for (const [name, use] of uses) attempt(name + " of " + JSON.stringify(text), () => use(text));
}
