// COUNT: counter:RegExp16BitSubjectsRejected >= 10
"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const names = ["$1", "$2", "lastMatch", "lastParen", "leftContext", "rightContext"];
const behind = () => names.map(name => name + "=" + JSON.stringify(RegExp[name])).join(" ");
const prime = () => /(p)(q)/.exec(JSON.parse('"opqr"'));
const texts = JSON.parse('["", "a1b22c333", "  two  words 7 ", "\\u2502 wide 4 \\u2502 text 42 \\u2502", "caf\\u00e9 9 \\u00e9t\\u00e9 10", "\\u2502\\u2502\\u2502"]');
for (const text of texts) { const cut = (text + "\u2502").slice(0, -1), lines = ("\u2502" + "ab 1\ncd 22\n\nef" + "\u2502").slice(1, -1), mixed = "ab 1\n\u2502\ncd"; for (const subject of [cut, lines, mixed]) for (const pattern of [/^([a-z]+) \d+$/gm, /^[a-z0-9 ]*$/g, /^[\x00-\x7f]+$/g, /^(\w+)$/gm]) { prime(); said.push(JSON.stringify([subject.replace(pattern, ""), subject.replace(pattern, "."), subject.replace(pattern, "($1)"), subject.match(pattern)?.length ?? null]) + " " + behind()); } }
console.log(said.join("\n"));
