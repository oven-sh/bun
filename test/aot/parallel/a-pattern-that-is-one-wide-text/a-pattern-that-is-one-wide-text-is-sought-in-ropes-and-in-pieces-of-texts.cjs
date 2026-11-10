"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const narrow = JSON.parse('["plain words", "caf\\u00e9 au lait", "", "x", "a.b.c"]'), wide = JSON.parse('["wait\\u2026 and see\\u2026", "\\u2026", "a\\u2026b", "\\u2028line", "snow \\u2603"]');
for (let i = 0; i < narrow.length; i++) { const rope = narrow[i] + "-" + narrow[(i + 1) % narrow.length] + more, mixed = narrow[i] + wide[i], piece = (narrow[i] + "0123456789abcdefghij").slice(1, 18), wideCut = (wide[i] + " tail of narrow letters").slice(wide[i].length);
  said.push(JSON.stringify([rope.replace(/\u2026/g, "."), mixed.replace(/\u2026/g, "."), piece.replace(/\u2026/g, "."), wideCut.replace(/\u2026/g, "."), wideCut.replace(/\u2026/, ".")])); }
console.log(said.join("\n"));
