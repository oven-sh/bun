"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const texts = JSON.parse('["", "a", "  two  words ", "one,two;;three", "x1y22z333", "\\u2502 wide \\u2502 text 42 \\u2502", "\\ud83d\\ude00a\\ud83d\\ude00", "aaaa", "line one\\nline two\\n\\nlast"]');
const line = texts[2] + texts[3] + texts[4], long = line.repeat(200 + more), wide = (line + texts[5]).repeat(150);
for (const text of [long, wide]) said.push(JSON.stringify([text.replace(/\s+/g, "").length, text.replace(/\d/g, "##").length, text.replace(/(\w)(\d)/g, "$2$1").length, text.match(/\w+/g).length, text.replace(/[a-z]+/g, "").slice(0, 40), text.replace(/\s+/g, " ").slice(-40)]));
console.log(said.join("\n"));
