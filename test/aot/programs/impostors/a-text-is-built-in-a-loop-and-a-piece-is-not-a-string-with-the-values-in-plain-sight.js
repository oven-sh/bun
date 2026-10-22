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

const made = {
  "['a', 'b', 'c']": () => (['a', 'b', 'c']),
  "[]": () => ([]),
  "['a', 1, 'b']": () => (['a', 1, 'b']),
  "[1, 2, 3]": () => ([1, 2, 3]),
  "[1, 2, 'a', 3, 4]": () => ([1, 2, 'a', 3, 4]),
  "[-0, -0]": () => ([-0, -0]),
  "[-0, 'a']": () => ([-0, 'a']),
  "[0.1, 0.2]": () => ([0.1, 0.2]),
  "[1n, 2n]": () => ([1n, 2n]),
  "[1n, 'a', 2n]": () => ([1n, 'a', 2n]),
  "[1n, 2]": () => ([1n, 2]),
  "[null, null]": () => ([null, null]),
  "[undefined, 1]": () => ([undefined, 1]),
  "[true, true]": () => ([true, true]),
  "[true, 'a']": () => ([true, 'a']),
  "['a', , 'b']": () => (['a', , 'b']),
  "[[1, 2], [3]]": () => ([[1, 2], [3]]),
  "[{}, 'a']": () => ([{}, 'a']),
  "['a', Symbol('s'), 'b']": () => (['a', Symbol('s'), 'b']),
  "[Symbol('s')]": () => ([Symbol('s')]),
  "[new String('a'), new String('b')]": () => ([new String('a'), new String('b')]),
  "[new Number(1), new Number(2)]": () => ([new Number(1), new Number(2)]),
  "[{ valueOf() { return 1; } }, { valueOf() { return 2; } }]": () => ([{ valueOf() { return 1; } }, { valueOf() { return 2; } }]),
  "[{ valueOf() { return 1; }, toString() { return 'x'; } }, 'a']": () => ([{ valueOf() { return 1; }, toString() { return 'x'; } }, 'a']),
  "[new Date(0), 1]": () => ([new Date(0), 1]),
  "['\\u00e9', '\\u4e16', '\\ud83d', '\\ude00']": () => (['\u00e9', '\u4e16', '\ud83d', '\ude00']),
  "'abc'": () => ('abc'),
  "new Set(['a', 1])": () => (new Set(['a', 1])),
  "{ length: 2, 0: 'a', 1: 1 }": () => ({ length: 2, 0: 'a', 1: 1 }),
  "null": () => (null),
};

function make(text) {
  return made[text]();
}

function joinPieces(pieces) {
  let text = "";
  for (let i = 0; i < pieces.length; i++) text += pieces[i];
  return text;
}

function joinWithCommas(pieces) {
  let text = "";
  for (const piece of pieces) {
    if (text !== "") text += ",";
    text += piece;
  }
  return text;
}

function joinFromNothing(pieces) {
  let text;
  for (const piece of pieces) text += piece;
  return text;
}

function joinFromTheFirst(pieces) {
  let text = pieces[0];
  for (let i = 1; i < pieces.length; i++) text += pieces[i];
  return text;
}

function prepend(pieces) {
  let text = "";
  for (const piece of pieces) text = piece + text;
  return text;
}

function joinInATemplate(pieces) {
  let text = "";
  for (const piece of pieces) text = `${text}${piece};`;
  return text;
}

const uses = [
  ["join", joinPieces],
  ["join with commas", joinWithCommas],
  ["join from nothing", joinFromNothing],
  ["join from the first", joinFromTheFirst],
  ["prepend", prepend],
  ["join in a template", joinInATemplate],
];

const lists = [
  "['a', 'b', 'c']",
  "[]",
  "['a', 1, 'b']",
  "[1, 2, 3]",
  "[1, 2, 'a', 3, 4]",
  "[-0, -0]",
  "[-0, 'a']",
  "[0.1, 0.2]",
  "[1n, 2n]",
  "[1n, 'a', 2n]",
  "[1n, 2]",
  "[null, null]",
  "[undefined, 1]",
  "[true, true]",
  "[true, 'a']",
  "['a', , 'b']",
  "[[1, 2], [3]]",
  "[{}, 'a']",
  "['a', Symbol('s'), 'b']",
  "[Symbol('s')]",
  "[new String('a'), new String('b')]",
  "[new Number(1), new Number(2)]",
  "[{ valueOf() { return 1; } }, { valueOf() { return 2; } }]",
  "[{ valueOf() { return 1; }, toString() { return 'x'; } }, 'a']",
  "[new Date(0), 1]",
  "['\\u00e9', '\\u4e16', '\\ud83d', '\\ude00']",
  "'abc'",
  "new Set(['a', 1])",
  "{ length: 2, 0: 'a', 1: 1 }",
  "null",
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) total += use(["a", "b", "c"]).length;
}
console.log("2000 honest rounds", total);

for (const [name, use] of uses) {
  for (const text of lists) attempt(name + " " + text, () => use(make(text)));
  attempt(name + " strings again", () => use(["a", "b", "c"]));
}
