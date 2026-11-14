// Both units lie beyond 255: units with the same low byte are none of them.
// Env of the build: BUN_JSC_verboseRegExpCompilation=1
// Build prints: 2 x Searches for the units at places 0 and 2 of a match in wide texts
// COUNT: counter:RegExpsCreatedWithoutRecord >= 1
// COUNT: counter:RegExpMatchesInterpreted >= 1000
"use strict";
const most = Number(process.argv[2] ?? 64);
const letter = code => String.fromCharCode(code + process.pid % 1);
const source = Array.from("\u2502[a-z]\u2192[a-z]+", unit => letter(unit.charCodeAt(0))).join("");
const literal = /│[a-z]→[a-z]+/g, made = new RegExp("(?:" + source + ")", "g");
const filler = JSON.parse("\"ab \\u2500\\u2501 cd \\u0102\\u0192 \""), whole = JSON.parse("\"\\u2502a\\u2192b\""), decoys = JSON.parse("[\"\\u2502\", \"\\u2192\", \"\\u2502a\", \"\\u2502a\\u2192\", \"\\u0002a\\u0092b\", \"\\u2602a\\u2692b\"]"), head = JSON.parse("\"\\u2502\"");
let cells = 0, wrong = 0, found = 0;
function ask(text) {
  for (let start = 0; start <= text.length; start += start < 3 || start + 3 > text.length ? 1 : 7) {
    literal.lastIndex = start; made.lastIndex = start;
    const a = literal.exec(text), b = made.exec(text);
    cells++;
    if (a) found++;
    if ((a ? a.index + ":" + a[0] : "none") !== (b ? b.index + ":" + b[0] : "none") || literal.lastIndex !== made.lastIndex) { if (wrong++ < 5) console.log("PARTS " + JSON.stringify([text, start, a && a.index, b && b.index])); }
  }
}
for (let length = 0; length <= most; length++) {
  let plain = ""; while (plain.length < length) plain += filler; plain = head + plain.slice(0, length);
  ask(plain);
  for (const piece of [whole, ...decoys])
    for (let place = head.length; place + piece.length <= plain.length + 2; place += place < 20 || place + piece.length + 20 > plain.length ? 1 : 5)
      ask((plain.slice(0, place) + piece + plain.slice(place + piece.length)).slice(0, plain.length));
}
console.log("SAID cells " + cells + " found " + found + " wrong " + wrong);
