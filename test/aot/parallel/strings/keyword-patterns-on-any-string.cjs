// Keyword patterns that are put together at run time on wide strings, ropes, with flags, with a lastIndex that runs code, and recompiled between two tests.
"use strict";
const shift = code => String.fromCharCode(code + process.pid % 1);
const run = text => Array.from(text, unit => shift(unit.charCodeAt(0))).join("");
const make = (words, flags = "") => new RegExp(run("^(?:") + run(words).replace(/ /g, "|") + run(")$"), flags);
const words = "break case catch café Δ Δx dΔ private package";
const wide = make(words), narrow = make(words.replace(/ [^ ]*Δ[^ ]*/g, ""));
const answers = [];
const padded = run("Δbreak caseΔcatchΔcaféΔx dΔprivate");
for (const pattern of [wide, narrow]) {
  for (const subject of ["break", "Δ", "Δx", "dΔ", "xΔ", "", "café", "cafΔ", padded.slice(1, 6), padded.slice(0, 1), padded.slice(7, 11), padded.slice(12, 17), padded.slice(18, 22), padded.slice(22, 24), padded.slice(25, 27), run("bre") + run("ak"), run("pack") + run("age"), run("pack") + run("agΔ")])
    answers.push(pattern.test(subject) ? subject.length : "-");
}
for (const flags of ["", "i", "m", "g", "y", "s", "u", "v", "d", "gi", "iu"]) {
  const pattern = make("break case café private package", flags);
  for (const subject of ["break", "BREAK", "x\nbreak", "break\n", "café", "CAFÉ", "package", "packagΔ"]) {
    for (const lastIndex of [0, 1, 3, -1, NaN, "2", { valueOf() { answers.push("v"); return 0; } }]) {
      pattern.lastIndex = lastIndex;
      const array = pattern.exec(subject);
      answers.push(array ? array.index + ":" + array[0].length : "n", typeof pattern.lastIndex === "object" ? "o" : String(pattern.lastIndex));
      pattern.lastIndex = 0;
      answers.push(pattern.test(subject) ? 1 : 0, subject.search(pattern));
    }
  }
}
const compiled = make("one two three");
answers.push(compiled.test("two"), compiled.compile(run("^(?:four|five)$")).test("two"), compiled.test("five"), compiled.compile(run("^(?:a|b)$"), "g").test("b"), compiled.lastIndex);
class Own extends RegExp { exec(subject) { answers.push("exec"); return super.exec(subject); } }
const own = new Own(run("^(?:one|two)$"));
answers.push(own.test("one"), own.test("three"), "two".match(own)[0]);
const groups = new RegExp(run("^(one|two)$")), optional = new RegExp(run("^(?:one|two)?$")), empty = new RegExp(run("^(?:one||two)$")), open = new RegExp(run("^(?:one|two)"));
for (const pattern of [groups, optional, empty, open]) for (const subject of ["one", "", "two", "onetwo", "on"]) answers.push(pattern.test(subject) ? 1 : 0);
const many = make(Array.from({ length: 1500 }, (_, index) => "word" + index.toString(36)).join(" "));
let hits = 0;
for (let index = 0; index < 1600; index++) hits += many.test("word" + index.toString(36)) ? index : 0;
answers.push(hits, make("x".repeat(5000) + " y").test("x".repeat(5000)), make("same same other same").test("same"));
for (let index = 0; index < 200; index++) answers.push(make("w" + index + " v" + index).test((index & 1 ? "w" : "v") + index) ? "" : "lost");
console.log(answers.join(" "));
