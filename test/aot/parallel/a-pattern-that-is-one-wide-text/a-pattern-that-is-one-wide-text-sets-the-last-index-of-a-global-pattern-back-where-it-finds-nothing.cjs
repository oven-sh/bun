"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const narrow = JSON.parse('["plain words", "caf\\u00e9 au lait", "", "x", "a.b.c"]'), wide = JSON.parse('["wait\\u2026 and see\\u2026", "\\u2026", "a\\u2026b", "\\u2028line", "snow \\u2603"]');
const dots = /\u2026/g, once = /\u2026/;
for (const text of [...narrow, ...wide]) { dots.lastIndex = 3 + more; once.lastIndex = 2; const a = text.replace(dots, "."), b = text.replace(once, "."); said.push(JSON.stringify([a, dots.lastIndex, b, once.lastIndex])); }
const held = Object.freeze(/\u2026/g);
for (const text of [narrow[0], wide[0]]) { try { said.push(text.replace(held, ".")); } catch (error) { said.push(error.constructor.name); } }
const odd = /\u2026/g; odd.lastIndex = { valueOf() { said.push("asked"); return 1; } };
said.push(narrow[0].replace(odd, "."), String(odd.lastIndex));
console.log(said.join("\n"));
