// Questions that look through the words of a split text: for parts of a text, joined texts, constants and what is no text.
"use strict";
const units = "mm cm dm m km in ft yd".split(" ");
const kinds = {
  length: "mm cm dm m km".split(" "),
  time: "ms s min h d".split(" "),
  none: "".split(" "),
};
const isUnit = text => units.includes(text);
function placeOf(kind, text) {
  const words = kinds[kind];
  for (let at = 0; at < words.length; at++) {
    if (words[at] === text) return at;
  }
  return -1;
}
function kindOf(text) {
  for (const kind in kinds) if (kinds[kind].indexOf(text) !== -1) return kind;
  return "?";
}
function read(line) {
  const found = [];
  let at = 0;
  while (at < line.length) {
    const start = at;
    while (at < line.length && line[at] !== " ") at++;
    let digits = start;
    while (digits < at && line[digits] >= "0" && line[digits] <= "9") digits++;
    const unit = line.slice(digits, at);
    found.push(isUnit(unit) + "/" + placeOf("length", unit) + "/" + placeOf("time", unit) + "/" + kindOf(unit));
    at++;
  }
  return found.join(" ");
}
for (let round = 0; round < 30; round++) {
  const answer = read("12km 3" + (round % 2 ? "min" : "m") + " 4 h 77xx 9ft 1" + "c".concat(round % 3 ? "m" : "x"));
  if (round % 10 < 2) console.log(round, answer);
}
console.log(isUnit("k" + "m"), isUnit("KM"), isUnit(""), isUnit(), placeOf("none", ""), kindOf(""), placeOf("time", "m" + String.fromCharCode(105) + "n"));
for (const other of [0, null, undefined, NaN, ["m"], { toString: () => "m" }, new String("m"), Symbol.for("m"), 12n, true]) console.log(isUnit(other), placeOf("length", other), kindOf(other));
units.push("li");
kinds.length[3] = "metre";
kinds.length.length = 4;
console.log(isUnit("li"), read("5m 6metre 7km 8li"));
kinds.time = Object.freeze(["s"]);
kinds.extra = [NaN, "x"];
console.log(kindOf("ms"), kindOf("s"), kindOf("x"), kindOf(NaN), [NaN].includes(NaN), kinds.extra.includes(NaN), placeOf("extra", NaN));
try {
  placeOf("width", "m");
} catch (error) {
  console.log(error.constructor.name);
}
