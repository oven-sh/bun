"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const texts = JSON.parse('["", "a", "  two  words ", "one,two;;three", "x1y22z333", "\\u2502 wide \\u2502 text 42 \\u2502", "\\ud83d\\ude00a\\ud83d\\ude00", "aaaa", "line one\\nline two\\n\\nlast"]');
for (const text of texts) said.push(JSON.stringify([text.replace(/\s+/g, ""), text.replace(/\s+/g, "_"), text.replace(/\d+/g, ""), text.replace(/[,;]/g, "|"), text.replace(/a*/g, "-"), text.replace(/(?:)/g, "."), text.replace(/(?:)/gu, "."), text.replace(/\b/g, "'"), text.replace(/$/gm, "<"), text.replace(/[^\x00-\x7f]+/g, "?")]));
console.log(said.join("\n"));
