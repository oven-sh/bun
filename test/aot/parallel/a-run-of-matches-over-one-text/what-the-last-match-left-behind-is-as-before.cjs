"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const texts = JSON.parse('["", "a", "  two  words ", "one,two;;three", "x1y22z333", "\\u2502 wide \\u2502 text 42 \\u2502", "\\ud83d\\ude00a\\ud83d\\ude00", "aaaa", "line one\\nline two\\n\\nlast"]');
for (const text of texts) { /seed(ed)/.exec("seeded"); const out = [text.replace(/(\w)(\d)?/g, ""), RegExp.lastMatch, RegExp.$1, RegExp.$2, RegExp.leftContext, RegExp.rightContext, RegExp.input]; out.push(text.replace(/(\s)/g, "_"), RegExp.lastMatch, RegExp.$1, RegExp["$`"].length); out.push((text.match(/(\w)\w*/g) ?? []).join("+"), RegExp.lastMatch, RegExp.$1); out.push(text.replace(/(z)(q)/g, ""), RegExp.lastMatch, RegExp.$1); said.push(JSON.stringify(out)); }
console.log(said.join("\n"));
