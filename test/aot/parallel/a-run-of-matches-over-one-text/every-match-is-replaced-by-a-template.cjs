"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const texts = JSON.parse('["", "a", "  two  words ", "one,two;;three", "x1y22z333", "\\u2502 wide \\u2502 text 42 \\u2502", "\\ud83d\\ude00a\\ud83d\\ude00", "aaaa", "line one\\nline two\\n\\nlast"]');
for (const text of texts) said.push(JSON.stringify([text.replace(/(\w)(\w)/g, "$2$1"), text.replace(/(\d)|(\s)/g, "[$1|$2]"), text.replace(/(?<n>\d+)/g, "<$<n>>"), text.replace(/\w+/g, "$&$&"), text.replace(/,/g, "$`"), text.replace(/;/g, "$'"), text.replace(/(a)?/g, "($1)")]));
console.log(said.join("\n"));
