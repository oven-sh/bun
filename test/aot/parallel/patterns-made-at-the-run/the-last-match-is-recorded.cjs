"use strict";
const n = process.argv.length, log = [];
const made = (source, flags) => new RegExp(source.replaceAll("#", String(n)), flags);
const show = found => found === null ? "null" : JSON.stringify([...found]) + "@" + found.index + (found.groups ? JSON.stringify(found.groups) : "") + (found.indices ? JSON.stringify(found.indices) : "");
const first = made("(a{#})(b)"); first.exec("zaabz"); first.exec("waabw"); first.exec("xaaby"); log.push(RegExp.$1, RegExp.$2, RegExp.lastMatch, RegExp.leftContext, RegExp.rightContext, RegExp.input); const second = made("q{#}[r]"); second.exec("none"); second.exec("nothing"); second.exec("nothing"); log.push(RegExp.$1, RegExp.lastMatch); const third = made("(c{#})[d]?"); third.exec("cc"); third.exec("cc"); third.exec("ccc".slice(0) + "d"); log.push(RegExp["$&"], RegExp["$`"], RegExp["$\x27"], RegExp.lastParen);
console.log("SAID", log.join(" | "));
