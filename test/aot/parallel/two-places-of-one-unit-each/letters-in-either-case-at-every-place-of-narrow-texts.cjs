// Under the flag i both units are ASCII letters in either case; units that differ from a letter in the bit of the case alone, and the Kelvin sign and the long s, are no such letters.
// Env of the build: BUN_JSC_verboseRegExpCompilation=1
// Build prints on x64: 2 x Searches for the units at places 0 and 2 of a match in narrow texts
// Build prints: 2 x Searches for the units at places 0 and 2 of a match in wide texts
// COUNT: counter:RegExpsCreatedWithoutRecord >= 1
// COUNT: counter:RegExpMatchesInterpreted >= 1000
"use strict";
const most = Number(process.argv[2] ?? 64);
const letter = code => String.fromCharCode(code + process.pid % 1);
const source = Array.from("k[0-9]s[0-9]+", unit => letter(unit.charCodeAt(0))).join("");
const literal = /k[0-9]s[0-9]+/gi, made = new RegExp("(?:" + source + ")", "gi");
const filler = JSON.parse("\"THE quick BROWN fox jumps OVER the lazy dog \""), whole = JSON.parse("\"K1s22\""), decoys = JSON.parse("[\"k1S2\", \"K\", \"s\", \"k1\", \"k1s\", \"K1S\", \"\\u000b1\\u00132\", \"+132\", \"k1\\u00132\", \"\\u00eb1\\u00f32\", \"\\u00cb1\\u00d32\"]"), head = JSON.parse("\"\"");
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
