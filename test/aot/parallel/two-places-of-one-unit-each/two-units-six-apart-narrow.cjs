// A place of the pattern holds two units. A pattern made at run time is interpreted and answers beside the literal.
// Env of the build: BUN_JSC_verboseRegExpCompilation=1
// Build prints on x64: 2 x Searches for the units at places 0 and 6 of a match in narrow texts
// Build prints: 2 x Searches for the units at places 0 and 6 of a match in wide texts
// COUNT: counter:RegExpsCreatedWithoutRecord >= 1
// COUNT: counter:RegExpMatchesInterpreted >= 1000
"use strict";
const most = Number(process.argv[2] ?? 64);
const source = Array.from("q[a-z]{5}[#%][0-9]+;", unit => String.fromCharCode(unit.charCodeAt(0) + (process.pid % 1))).join("");
const literal = /q[a-z]{5}[#%][0-9]+;/g;
const atRunTime = new RegExp("(?:" + source + ")", "g");
const filler = JSON.parse('"the quick brown fox jumps over the lazy dog then it eats "');
const matches = JSON.parse('["qabcde#1;", "qabcde%22;"]');
const decoys = JSON.parse('["q", "qabcde", "qabcde$1;", "abcde#1", "qqqqqqq#1", "qabcd#1;", "q12345#1;"]');
const head = JSON.parse('""');
let cells = 0;
let wrong = 0;
let found = 0;
function ask(text) {
  for (let start = 0; start <= text.length; start += start < 3 || start + 3 > text.length ? 1 : 7) {
    literal.lastIndex = start;
    atRunTime.lastIndex = start;
    const a = literal.exec(text);
    const b = atRunTime.exec(text);
    cells++;
    if (a) found++;
    const isSame = (a ? a.index + ":" + a[0] : "none") === (b ? b.index + ":" + b[0] : "none") && literal.lastIndex === atRunTime.lastIndex;
    if (!isSame && wrong++ < 5) console.log("DIFFERS " + JSON.stringify([text, start, a && a.index, b && b.index]));
  }
}
for (let length = 0; length <= most; length++) {
  let plain = "";
  while (plain.length < length) plain += filler;
  plain = head + plain.slice(0, length);
  ask(plain);
  for (const piece of [...matches, ...decoys]) {
    for (let place = head.length; place + piece.length <= plain.length + 2; place += place < 20 || place + piece.length + 20 > plain.length ? 1 : 5) {
      ask((plain.slice(0, place) + piece + plain.slice(place + piece.length)).slice(0, plain.length));
    }
  }
}
console.log("cells " + cells + " found " + found + " wrong " + wrong);
