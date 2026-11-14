// STATISTIC: SearchesOfWordsSwitched >= 2
"use strict";

// Lists of words that a file keeps in constants are searched in loops. Some are changed in between, by every road that changes a list.
const KEYWORDS = ["if", "if", "else", "function", "return", "while", "typeof", "instanceof", "switch", "case", "default", "break", "new", "delete", "in", "var", "this", "if"];
const SHORT = ["a", "b"];
const GROWN = ["if", "else", "x"];
const CUT = ["if", "else", "in", "x", "y"];
const SET_AT = ["if", "else", "in", "x"];
const SORTED = ["in", "if", "else", "a", "x"];
const FROZEN = Object.freeze(["if", "else", "in", "x"]);
const OWNED = ["if", "else", "x"];
const HEIR = ["if", "else", "x"];
const HOLED = ["if", "else", "x", "in"];
const FILLED = ["if", "else", "x", "in"];
const PASSED = ["if", "else", "x", "in"];
const ALIASED = ["if", "else", "x", "in"];
const alias = ALIASED;

const source = "if else function instanceof in x y z this a b switch";
const texts = source.split(" ");
for (let at = 0, i = 0; i < 12; i++) {
  const end = source.indexOf(" ", at + 1) < 0 ? source.length : source.indexOf(" ", at + 1);
  texts.push(source.slice(at, end), source.slice(at, end).trim());
  at = end;
}
texts.push("", undefined, null, 0, NaN, "in" + "stance" + (process.argv.length > 90 ? "" : "of"), new String("if"), Symbol.iterator, 3n, ["if"], "é");

function count(list) {
  let found = 0;
  for (const text of texts) if (list.includes(text)) found++;
  return found;
}
function change(list) {
  list.push("pushed by a callee");
}

function search() {
  const row = [];
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    row.push(KEYWORDS.includes(text) ? 1 : 0, KEYWORDS.indexOf(text), SHORT.includes(text), GROWN.includes(text), GROWN.indexOf(text), CUT.indexOf(text), SET_AT.includes(text), SORTED.indexOf(text), FROZEN.includes(text), OWNED.includes(text), HEIR.includes(text), HOLED.includes(text), HOLED.indexOf(text), FILLED.includes(text), PASSED.indexOf(text), ALIASED.includes(text));
  }
  return row.join("").replaceAll("true", "t").replaceAll("false", "f");
}
console.log(search());
GROWN.push("in");
CUT.length = 2;
SET_AT[1] = "z";
SORTED.sort();
OWNED.includes = (text) => text === "own";
Object.setPrototypeOf(HEIR, { includes: () => "heir" });
delete HOLED[1];
FILLED.fill("y", 1, 3);
change(PASSED);
alias.unshift("z");
console.log(search());
let trouble = "";
try {
  FROZEN.push("no");
} catch (error) {
  trouble = error.name;
}
console.log(trouble, search());

// The list changes while the loop runs.
const LATE = ["if", "else", "in", "x", "y", "z", "this", "switch", "a"];
function searchWhileChanging() {
  const row = [];
  for (let i = 0; i < texts.length; i++) {
    row.push(LATE.indexOf(texts[i]));
    if (i === 5) LATE.reverse();
    if (i === 9) LATE.splice(1, 2, "b", "b", "b");
    if (i === 14) LATE.copyWithin(0, 3);
    if (i === 20) LATE[40] = "far";
    if (i === 25) LATE.pop();
  }
  return row.join();
}
console.log(searchWhileChanging(), count(KEYWORDS), count(SHORT), count(LATE));
