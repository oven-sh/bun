"use strict";
const n = process.argv.length, log = [];
const made = (source, flags) => new RegExp(source.replaceAll("#", String(n)), flags);
const show = found => found === null ? "null" : JSON.stringify([...found]) + "@" + found.index + (found.groups ? JSON.stringify(found.groups) : "") + (found.indices ? JSON.stringify(found.indices) : "");
for (const [source, text] of [["(a{#})\\\\1", "aaaa"], ["(a{#})\\\\1", "aaa"], ["(?=(a{#}))a", "baa"], ["(?<=b{#})a", "bba"], ["(?<!b{#})a", "bba a"], ["(?!a{#})a", "aaab"], ["(a*?)(a{#})$", "aaaa"], ["(a+)+b{#}", "aaaaaaaaaaaaaaaaaaac"], ["^(?:(a)|b)*$", "aab"], ["(z)((a+)?(b+)?(c))*", "zaacbbbcac"]]) { const pattern = made(source); for (let turn = 0; turn < 3; turn++) log.push(show(pattern.exec(text))); }
console.log("SAID", log.join(" | "));
