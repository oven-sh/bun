"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const narrow = JSON.parse('["plain words", "caf\\u00e9 au lait", "", "x", "a.b.c"]'), wide = JSON.parse('["wait\\u2026 and see\\u2026", "\\u2026", "a\\u2026b", "\\u2028line", "snow \\u2603"]');
for (const text of [...narrow, ...wide]) said.push(JSON.stringify([text.replace(/\u2026/g, "..."), text.replace(/\u2026/, "."), text.replace(/\u2028/g, " "), text.replaceAll(/\u2603/g, "*"), text.replace(/\u2026/g, "$&$&"), text.replace(/\u2026/g, "")]));
console.log(said.join("\n"));
