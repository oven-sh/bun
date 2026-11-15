"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const narrow = JSON.parse('["plain words", "caf\\u00e9 au lait", "", "x", "a.b.c"]'), wide = JSON.parse('["wait\\u2026 and see\\u2026", "\\u2026", "a\\u2026b", "\\u2028line", "snow \\u2603"]');
for (const text of [...narrow, ...wide, "a\u2026", "\u2026a", "xa\u2026y\u2026a"]) said.push(JSON.stringify([text.replace(/a\u2026/g, "<1>"), text.replace(/\u2026a/g, "<2>"), text.replace(/\u00e9/g, "e"), text.replace(/\u00e9\u2026/g, "<3>"), text.replace(/\u0100/g, "<4>"), text.replace(/\u00ff/g, "<5>")]));
console.log(said.join("\n"));
