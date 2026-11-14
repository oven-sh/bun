// STATISTIC: SearchesOfWordsSwitched >= 4
"use strict";

// Searches in lists of words that are written at the call: any value, any kind of text, prototypes that change in between.
function isKeyword(x) {
  return ["if", "else", "in", "instanceof", "", "if", "é", "\u{1f600}", "__proto__", "0", "constructor"].includes(x);
}
function placeOf(x) {
  return ["if", "else", "in", "instanceof", "", "if", "é", "\u{1f600}", "__proto__", "0", "constructor"].indexOf(x);
}
function isOneOfTwo(x) {
  return ["a", "b"].indexOf(x) !== -1;
}
function mixed(x) {
  return ["a", 1, null, NaN, undefined, true].includes(x);
}
function withHole(x) {
  return ["a", , "b"].includes(x);
}
function fromPlace(x, from) {
  return ["a", "b", "c", "a"].indexOf(x, from);
}
function kept(x) {
  const words = ["a", "b"];
  if (x === "grow") words.push("grow");
  return words.includes(x);
}
function returned(x, out) {
  const words = ["a", "b"];
  out.push(words);
  return words.includes(x) ? words.length : -1;
}
function last(x) {
  return ["a", "b", "a"].lastIndexOf(x);
}
function spread(...x) {
  return ["a", "b"].includes(...x);
}
function none() {
  return ["a", "undefined"].includes();
}

const joined = "in" + "stance" + (process.argv.length > 100 ? "" : "of");
const source = "xifelse instanceof constructor __proto__ é\u{1f600} 0";
const texts = ["if", "else", "in", "instanceof", "", "i", "iff", "é", "\u{1f600}", "\ud83d", "__proto__", "0", "constructor", joined, source.slice(1, 3), source.slice(3, 7), source.slice(8, 18), source.slice(8, 10), source.slice(19, 30),
  "a", "b", "c", "grow", ["i", "f"].join(""), "instance" + String.fromCharCode(111, 102), new String("if"), 0, -0, NaN, 1, null, undefined, true, 12n, Symbol.iterator, ["if"], { toString: () => "if" }, () => "if"];

function show(x) {
  return typeof x === "symbol" ? "symbol" : typeof x === "object" && x !== null ? Object.prototype.toString.call(x) : typeof x + String(x);
}
function round() {
  const rows = [];
  for (const text of texts) {
    const out = [];
    rows.push([show(text), isKeyword(text), placeOf(text), isOneOfTwo(text), mixed(text), withHole(text), fromPlace(text, 1), fromPlace(text, -1), fromPlace(text, undefined), kept(text), returned(text, out), last(text), spread(text), spread(text, 1), none()].join(" "));
  }
  return rows.join("\n");
}
function inLoop() {
  let found = 0;
  let places = 0;
  for (let i = 0; i < texts.length; i++) {
    if (["if", "else", "in", "instanceof", "é"].includes(texts[i])) found++;
    places += ["if", "else", "in", "instanceof", "é"].indexOf(texts[i]);
    if (["x"].includes(texts[i])) found += 100;
    if (!["i", "if"].includes(texts[i])) places += 1000;
    switch (["b", "a"].indexOf(texts[i])) {
      case 0:
        found += 10;
        break;
      case 1:
        found += 20;
    }
  }
  return found + " " + places;
}
console.log(round());
console.log(inLoop());
