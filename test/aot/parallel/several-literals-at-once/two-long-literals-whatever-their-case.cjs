// The same under the flag i.
// COUNT: counter:RegExpsCreatedWithoutRecord >= 1
// COUNT: counter:RegExpMatchesInterpreted >= 1000
"use strict";
const most = Number(process.argv[2] ?? 48);
const letter = code => String.fromCharCode(code + process.pid % 1);
const source = Array.from("agggtaaacgtacgtaaggt|tttaccctacgtacgttcca", unit => letter(unit.charCodeAt(0))).join("");
const literal = /agggtaaacgtacgtaaggt|tttaccctacgtacgttcca/gi, made = new RegExp("(?:" + source + ")", "gi");
const hits = JSON.parse("[\"agggtaaacgtacgtaaggt\", \"TTTACCCTACGTACGTTCCA\", \"AgGgTaAaCgTaCgTaAgGt\", \"agggtaaacgtacgtaagg\", \"tttaccctacgtacgttcc\"]"), fillers = JSON.parse("[\"x\", \"acgt\", \"tttagggt\"]");
let cells = 0, wrong = 0, found = 0;
function ask(text) {
  for (const start of [0, 1, text.length >> 1]) {
    literal.lastIndex = start; made.lastIndex = start;
    const a = literal.exec(text), b = made.exec(text);
    cells++;
    if (a) found++;
    if ((a ? a.index + ":" + a[0] : "none") !== (b ? b.index + ":" + b[0] : "none")) { if (wrong++ < 5) console.log("PARTS " + JSON.stringify([text, start, a && a.index, b && b.index])); }
  }
}
for (const head of ["", "│"]) for (const filler of fillers) for (const hit of hits)
  for (let lead = 0; lead <= most; lead++) for (let tail = 0; tail <= most; tail += tail < 20 ? 1 : 7)
    ask(head + filler.repeat(lead).slice(0, lead) + hit + filler.repeat(tail).slice(0, tail));
console.log("SAID cells " + cells + " found " + found + " wrong " + wrong);
