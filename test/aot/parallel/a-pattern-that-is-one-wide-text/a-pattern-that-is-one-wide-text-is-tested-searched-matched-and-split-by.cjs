"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const narrow = JSON.parse('["plain words", "caf\\u00e9 au lait", "", "x", "a.b.c"]'), wide = JSON.parse('["wait\\u2026 and see\\u2026", "\\u2026", "a\\u2026b", "\\u2028line", "snow \\u2603"]');
const kept = /\u2026/, all = /\u2026/g;
for (const text of [...narrow, ...wide]) { all.lastIndex = 1; said.push(JSON.stringify([/\u2026/.test(text), kept.test(text), kept.exec(text)?.index ?? null, text.search(/\u2026/), text.match(/\u2026/g)?.length ?? null, text.match(kept)?.index ?? null, text.split(/\u2026/).length, all.test(text), all.lastIndex, [...text.matchAll(/\u2026/g)].length])); }
console.log(said.join("\n"));
