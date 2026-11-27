// Seven places are left behind a group of four in a wide text; the last of the next three may be classes.
// COUNT: counter:RegExpsCreatedWithoutRecord >= 1
// COUNT: counter:RegExpMatchesInterpreted >= 100
"use strict";
const most = Number(process.argv[2] ?? 9);
const letter = code => String.fromCharCode(code + process.pid % 1);
const source = Array.from("T\\d\\d:\\d\\d:\\d\\d\\.00Z", unit => letter(unit.charCodeAt(0))).join("");
const literal = /T\d\d:\d\d:\d\d\.00Z/, made = new RegExp("(?:" + source + ")", "");
const hit = "T03:00:59.00Z";
let cells = 0, wrong = 0, found = 0;
function ask(text) {
  const a = literal.exec(text), b = made.exec(text);
  cells++;
  if (a) found++;
  if ((a ? a.index + ":" + a[0] : "none") !== (b ? b.index + ":" + b[0] : "none")) { if (wrong++ < 5) console.log("PARTS " + JSON.stringify([text, a && a.index, b && b.index])); }
}
const others = ["", "~", letter(0), "X", "_", "5"];
for (const head of ["", letter(0x2192), letter(0x2192) + " "]) for (const tail of ["", " end", letter(0x2013)])
  for (let lead = 0; lead <= most; lead++) for (let place = 0; place < hit.length; place++) for (const other of others)
    ask(head + ".".repeat(lead) + (other ? hit.slice(0, place) + other + hit.slice(place + 1) : hit) + tail);
console.log("SAID cells " + cells + " found " + found + " wrong " + wrong);
