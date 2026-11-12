"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const texts = JSON.parse('["", "a", "  two  words ", "one,two;;three", "x1y22z333", "\\u2502 wide \\u2502 text 42 \\u2502", "\\ud83d\\ude00a\\ud83d\\ude00", "aaaa", "line one\\nline two\\n\\nlast"]');
const blanks = /\s+/g, digits = /(\d)+/g;
for (const text of texts) { blanks.lastIndex = 2 + more; digits.lastIndex = 1; said.push(JSON.stringify([text.replace(blanks, ""), blanks.lastIndex, text.replace(digits, "#$1"), digits.lastIndex, text.match(digits)?.join() ?? null, digits.lastIndex, digits.test(text), digits.lastIndex])); digits.lastIndex = 0; }
console.log(said.join("\n"));
