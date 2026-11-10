"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const texts = JSON.parse('["", "a", "  two  words ", "one,two;;three", "x1y22z333", "\\u2502 wide \\u2502 text 42 \\u2502", "\\ud83d\\ude00a\\ud83d\\ude00", "aaaa", "line one\\nline two\\n\\nlast"]');
for (const text of texts) said.push(JSON.stringify([text.replace(/(?<=\w)\s/g, "~"), text.replace(/(\w)\1/g, "<$1>"), text.replace(/(?=\d)/g, "^"), text.replace(/(?<!a)a/g, "A"), text.replace(/\w(?!\w)/g, "!"), text.replace(/(a+)+$/g, "E")]));
console.log(said.join("\n"));
