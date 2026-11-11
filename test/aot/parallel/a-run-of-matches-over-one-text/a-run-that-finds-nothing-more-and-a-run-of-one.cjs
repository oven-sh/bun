"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const names = ["$1", "$2", "lastMatch", "lastParen", "leftContext", "rightContext"];
const behind = () => names.map(name => name + "=" + JSON.stringify(RegExp[name])).join(" ");
const prime = () => /(p)(q)/.exec(JSON.parse('"opqr"'));
const texts = JSON.parse('["", "a1b22c333", "  two  words 7 ", "\\u2502 wide 4 \\u2502 text 42 \\u2502", "caf\\u00e9 9 \\u00e9t\\u00e9 10", "\\u2502\\u2502\\u2502"]');
for (const text of texts) for (const pattern of [/(\d)\d\d/g, /^(\s)/g, /(.)$/g, /(\u2502)$/g, /(z)/g]) { prime(); said.push(JSON.stringify([text.replace(pattern, ""), text.replace(pattern, "!"), text.replace(pattern, "$1$1"), text.match(pattern)?.length ?? null]) + " " + behind() + " " + pattern.lastIndex); }
console.log(said.join("\n"));
