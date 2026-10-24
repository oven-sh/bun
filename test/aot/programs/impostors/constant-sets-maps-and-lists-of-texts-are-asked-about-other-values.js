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

const KEYWORDS = new Set(["if", "else", "for", "1", "null", "undefined", "NaN", "", "true"]);
const PRIORITY = new Map([["+", 1], ["*", 2], ["1", 3], ["null", 4], ["", 5]]);
const LIST = ["if", "else", "for", "1", "null", "undefined", "NaN", "", "true"];
const TABLE = { if: 1, else: 2, for: 3, 1: 4, null: 5, undefined: 6, NaN: 7, "": 8, true: 9 };
const FROZEN = Object.freeze({ if: 1, else: 2 });
const LETTERS = "if else for 1 null undefined NaN true";

function isKeyword(word) {
  return KEYWORDS.has(word);
}

function priorityOf(word) {
  return PRIORITY.get(word);
}

function hasPriority(word) {
  return PRIORITY.has(word);
}

function isListed(word) {
  return LIST.includes(word);
}

function positionInTheList(word) {
  return LIST.indexOf(word);
}

function isListedInALiteral(word) {
  return ["if", "else", "1", "null"].includes(word);
}

function isInTheTable(word) {
  return word in TABLE;
}

function fromTheTable(word) {
  return TABLE[word];
}

function ownInTheTable(word) {
  return Object.hasOwn(TABLE, word);
}

function fromTheFrozenTable(word) {
  return FROZEN[word];
}

function isInTheLetters(word) {
  return LETTERS.includes(word);
}

function oneOfThree(word) {
  return word === "if" || word === "else" || word === "1";
}

function looselyOneOfThree(word) {
  return word == "if" || word == "else" || word == "1";
}

const uses = [
  ["Set.has", isKeyword],
  ["Map.get", priorityOf],
  ["Map.has", hasPriority],
  ["includes", isListed],
  ["indexOf", positionInTheList],
  ["literal includes", isListedInALiteral],
  ["in", isInTheTable],
  ["table", fromTheTable],
  ["hasOwn", ownInTheTable],
  ["frozen", fromTheFrozenTable],
  ["text includes", isInTheLetters],
  ["===", oneOfThree],
  ["==", looselyOneOfThree],
];

const values = [
  "'if'",
  "'i' + 'f'",
  "'iffy'.slice(0, 2)",
  "'if\\u4e16'.slice(0, 2)",
  "'IF'",
  "'+'",
  "''",
  "'1'",
  "1",
  "1n",
  "1.0",
  "true",
  "'true'",
  "null",
  "'null'",
  "undefined",
  "'undefined'",
  "NaN",
  "'NaN'",
  "new String('if')",
  "new String('')",
  "new Number(1)",
  "['if']",
  "[1]",
  "[]",
  "{ toString() { return 'if'; } }",
  "Symbol('if')",
  "'constructor'",
  "'__proto__'",
  "'toString'",
  "'size'",
  "'length'",
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) total += String(use(i % 2 ? "if" : "while")).length;
}
console.log("2000 honest rounds", total);

function outcome(use, text) {
  try {
    const result = use(make(text));
    return typeof result === "function" ? "function " + result.name : result === Object.prototype ? "Object.prototype" : show(result);
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

for (const text of values) {
  for (let from = 0; from < uses.length; from += 5) {
    console.log(text + " -> " + uses.slice(from, from + 5).map(([name, use]) => name + " " + outcome(use, text)).join("; "));
  }
}

KEYWORDS.add(1);
KEYWORDS.delete("if");
PRIORITY.set(1, "the number");
LIST.push(1);
LIST[0] = new String("if");
TABLE.while = 10;
delete TABLE.if;
console.log("after the collections were changed");
for (const text of ["'if'", "1", "'1'", "'while'"]) {
  console.log(text + " -> " + uses.map(([name, use]) => name + " " + outcome(use, text)).join("; "));
}
