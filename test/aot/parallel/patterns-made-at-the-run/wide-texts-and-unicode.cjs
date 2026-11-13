"use strict";
const n = process.argv.length, log = [];
const made = (source, flags) => new RegExp(source.replaceAll("#", String(n)), flags);
const show = found => found === null ? "null" : JSON.stringify([...found]) + "@" + found.index + (found.groups ? JSON.stringify(found.groups) : "") + (found.indices ? JSON.stringify(found.indices) : "");
for (const [source, flags, text] of [["(\\u00e9{#})", "", "caf\\u00e9\\u00e9"], ["(\\u4e2d{#})", "", "x\\u4e2d\\u4e2dy"], ["a{#}", "", "\\u4e2daa"], ["^.{#}$", "u", "\\ud83d\\ude00\\ud83d\\ude00"], ["^.{#}$", "", "\\ud83d\\ude00"], ["\\\\udE00", "", "\\ud83d\\ude00"], ["\\\\udE00", "u", "\\ud83d\\ude00"], ["[\\\\p{L}]{#}", "u", "1\\u00e9\\u4e2d2"], ["K{#}", "i", "kK"], ["\\u212a{#}", "iu", "kK"], ["[a-z]{#}", "v", "1ab"]]) { const pattern = made(source, flags); for (let turn = 0; turn < 3; turn++) log.push(show(pattern.exec(text))); }
console.log("SAID", log.join(" | "));
